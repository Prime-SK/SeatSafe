import { Injectable, DestroyRef, NgZone, computed, inject, signal } from '@angular/core';
import { HttpErrorResponse, HttpEvent, HttpHandlerFn, HttpRequest } from '@angular/common/http';
import {
  Observable,
  catchError,
  defer,
  finalize,
  map,
  of,
  shareReplay,
  switchMap,
  tap,
  throwError,
} from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { LoginApi, AccountSummary, LoginInput, LoginResult } from './login-api';
import { SessionCoordinator, SessionNotice } from './session-coordinator';

export type SessionStatus =
  'checking' | 'signed-in' | 'anonymous' | 'unavailable' | 'signing-out' | 'logout-failed';
const unavailable = () => new Error('Session is unavailable');
const unauthorized = () => new HttpErrorResponse({ status: 401, statusText: 'Unauthorized' });
@Injectable({ providedIn: 'root' })
export class Authentication {
  private readonly api = inject(LoginApi);
  private readonly coordinator = inject(SessionCoordinator);
  private readonly zone = inject(NgZone);
  #session = signal<{ accessToken: string; account: AccountSummary; expiresAt: number } | null>(
    null,
  );
  #status = signal<SessionStatus>('anonymous');
  #message = signal('');
  #expired = signal(false);
  #loginPending = signal(false);
  readonly loginPending = this.#loginPending.asReadonly();
  #generation = 0;
  #initialized = false;
  #restoreNeeded = signal(false);
  #destroyed = false;
  private expiryTimer: ReturnType<typeof setTimeout> | undefined;
  private refreshFlight: Observable<void> | undefined;
  private loginFlight: Observable<void> | undefined;
  private logoutFlight: Observable<void> | undefined;
  readonly status = this.#status.asReadonly();
  readonly message = this.#message.asReadonly();
  readonly account = computed(() => this.#session()?.account ?? null);
  readonly authenticated = computed(
    () => this.#status() === 'signed-in' && !!this.#session() && !this.#expired(),
  );
  readonly restoreNeeded = this.#restoreNeeded.asReadonly();
  readonly supported = this.coordinator.supported;
  readonly canLogin = computed(
    () =>
      this.supported &&
      !this.#loginPending() &&
      !['checking', 'signing-out', 'logout-failed'].includes(this.#status()),
  );
  constructor() {
    this.coordinator.notices.pipe(takeUntilDestroyed()).subscribe((notice) => this.receive(notice));
    inject(DestroyRef).onDestroy(() => {
      this.#destroyed = true;
      this.clear();
    });
  }
  initialize(): Observable<void> {
    if (this.#initialized) return this.refreshFlight ?? of(undefined);
    this.#initialized = true;
    if (this.#session()) return of(undefined);
    if (!this.supported) {
      this.fail('This browser cannot manage SeatSafe sessions. Please use a current browser.');
      return of(undefined);
    }
    return this.refresh().pipe(catchError(() => of(undefined)));
  }
  ensureSession(): Observable<void> {
    return defer(() => {
      if (this.usable()) return of(undefined);
      if (this.refreshFlight) return this.refreshFlight;
      if (['unavailable', 'signing-out', 'logout-failed'].includes(this.#status()))
        return throwError(unavailable);
      if (this.#initialized && !this.#session() && !this.#restoreNeeded())
        return throwError(unauthorized);
      this.#initialized = true;
      return this.refresh();
    });
  }
  login(input: LoginInput): Observable<void> {
    if (this.loginFlight) return this.loginFlight;
    if (!this.canLogin()) return throwError(unavailable);
    const operation = defer(() => {
      this.#loginPending.set(true);
      return this.coordinator.run(() => {
        if (
          !this.supported ||
          ['checking', 'signing-out', 'logout-failed'].includes(this.#status()) ||
          this.#destroyed
        )
          return throwError(unavailable);
        const generation = ++this.#generation;
        this.clear();
        this.#status.set('anonymous');
        this.#message.set('');
        this.#restoreNeeded.set(false);
        const startedAt = Date.now();
        return this.api.login(input).pipe(
          tap((result) => {
            this.assertCurrent(generation);
            this.install(result, startedAt);
            this.coordinator.announce('session-changed');
          }),
          map(() => undefined),
          catchError((error) => {
            if (
              generation === this.#generation &&
              (!(error instanceof HttpErrorResponse) || error.status === 0 || error.status >= 500)
            ) {
              this.fail('Sign-in could not be completed. Please sign in again.');
              this.coordinator.announce('session-unavailable');
            }
            return throwError(() => error);
          }),
        );
      });
    });
    this.loginFlight = operation.pipe(
      finalize(() => {
        this.loginFlight = undefined;
        this.#loginPending.set(false);
      }),
      shareReplay({ bufferSize: 1, refCount: false }),
    );
    return this.loginFlight;
  }
  logout(): Observable<void> {
    if (this.logoutFlight) return this.logoutFlight;
    if (!this.supported) return throwError(unavailable);
    // Publish intent before waiting for the cookie lock; late refresh responses must not restore identity.
    ++this.#generation;
    this.clear();
    this.#restoreNeeded.set(false);
    this.#status.set('signing-out');
    this.#message.set('');
    this.coordinator.announce('logout-started');
    const operation = this.coordinator.run(() => {
      const generation = this.#generation;
      return this.api.logout().pipe(
        tap(() => {
          if (!this.#destroyed && generation === this.#generation) {
            this.endSession();
            this.coordinator.announce('logout-completed');
          }
        }),
        catchError((error) => {
          if (!this.#destroyed && generation === this.#generation) {
            this.#status.set('logout-failed');
            this.#message.set(
              'Could not sign out. Your session may still be active, including after reload. Please retry sign out.',
            );
            this.coordinator.announce('session-unavailable');
          }
          return throwError(() => error);
        }),
      );
    });
    this.logoutFlight = operation.pipe(
      finalize(() => (this.logoutFlight = undefined)),
      shareReplay({ bufferSize: 1, refCount: false }),
    );
    return this.logoutFlight;
  }
  /** The interceptor owns the request stream; credentials are never exposed through UI signals. */
  send(request: HttpRequest<unknown>, next: HttpHandlerFn): Observable<HttpEvent<unknown>> {
    return this.ensureSession().pipe(
      switchMap(() => {
        const generation = this.#generation;
        const token = this.#session()!.accessToken;
        const authorized = request.clone({ setHeaders: { Authorization: `Bearer ${token}` } });
        return next(authorized).pipe(
          catchError((error) => {
            if (
              !(error instanceof HttpErrorResponse) ||
              error.status !== 401 ||
              generation !== this.#generation
            )
              return throwError(() => error);
            if (request.method !== 'GET') {
              this.endSession();
              return throwError(() => error);
            }
            const recovery =
              this.usable() && this.#session()?.accessToken !== token
                ? of(undefined)
                : this.refresh();
            return recovery.pipe(
              switchMap(() => {
                this.assertCurrent(generation);
                if (!this.usable()) return throwError(unauthorized);
                return next(
                  request.clone({
                    setHeaders: { Authorization: `Bearer ${this.#session()!.accessToken}` },
                  }),
                ).pipe(
                  catchError((secondError) => {
                    if (
                      secondError instanceof HttpErrorResponse &&
                      secondError.status === 401 &&
                      generation === this.#generation
                    ) {
                      this.endSession();
                      this.coordinator.announce('logout-completed');
                    }
                    return throwError(() => secondError);
                  }),
                );
              }),
            );
          }),
        );
      }),
    );
  }
  updateProfile(profile: AccountSummary, generation: number): void {
    if (generation === this.#generation && this.#session() && this.#status() === 'signed-in') {
      const safe = this.safeProfile(profile);
      this.#session.update((session) => (session ? { ...session, account: safe } : null));
    }
  }
  currentGeneration(): number {
    return this.#generation;
  }
  private refresh(): Observable<void> {
    if (this.refreshFlight) return this.refreshFlight;
    if (!this.supported || ['signing-out', 'logout-failed', 'unavailable'].includes(this.#status()))
      return throwError(unavailable);
    const generation = this.#generation;
    this.#status.set('checking');
    this.#message.set('');
    const operation = this.coordinator
      .run(() => {
        this.assertCurrent(generation);
        const startedAt = Date.now();
        return this.api.refresh().pipe(
          tap((result) => {
            this.assertCurrent(generation);
            this.install(result, startedAt);
          }),
          map(() => undefined),
        );
      })
      .pipe(
        catchError((error) => {
          if (generation === this.#generation && !this.#destroyed) {
            if (error instanceof HttpErrorResponse && error.status === 401) {
              this.endSession();
              this.coordinator.announce('logout-completed');
            } else {
              const status = error instanceof HttpErrorResponse ? error.status : -1;
              this.fail(
                status === 429
                  ? 'Too many session checks. Please wait before signing in again.'
                  : status === 403
                    ? 'Session access is unavailable from this page. Please open SeatSafe and sign in again.'
                    : status === 0
                      ? 'Unable to connect. Check your connection, then sign in again.'
                      : 'Your session could not be restored. Please sign in again.',
              );
              this.coordinator.announce('session-unavailable');
            }
          }
          return throwError(() => error);
        }),
      );
    this.refreshFlight = operation.pipe(
      finalize(() => (this.refreshFlight = undefined)),
      shareReplay({ bufferSize: 1, refCount: false }),
    );
    return this.refreshFlight;
  }
  private install(result: LoginResult, startedAt: number): void {
    const expiresAt = startedAt + result.expiresIn * 1000;
    if (
      typeof result.accessToken !== 'string' ||
      !result.accessToken ||
      result.tokenType !== 'Bearer' ||
      !Number.isInteger(result.expiresIn) ||
      result.expiresIn <= 0 ||
      !Number.isFinite(expiresAt) ||
      expiresAt <= Date.now()
    )
      throw new Error('Unable to establish authentication');
    const account = this.safeProfile(result.user);
    this.clear();
    this.#expired.set(false);
    this.#restoreNeeded.set(false);
    this.#session.set({ accessToken: result.accessToken, account, expiresAt });
    this.#status.set('signed-in');
    this.#message.set('');
    this.zone.runOutsideAngular(() => {
      this.expiryTimer = setTimeout(
        () => this.zone.run(() => this.#expired.set(true)),
        expiresAt - Date.now(),
      );
    });
  }
  private safeProfile(user: AccountSummary): AccountSummary {
    if (
      !user ||
      typeof user.id !== 'string' ||
      !user.id ||
      typeof user.displayName !== 'string' ||
      typeof user.email !== 'string' ||
      !['USER', 'ADMIN'].includes(user.role)
    )
      throw new Error('Unable to establish authentication');
    const { id, displayName, email, role } = user;
    return { id, displayName, email, role };
  }
  private usable(): boolean {
    return (
      this.#status() === 'signed-in' && !!this.#session() && this.#session()!.expiresAt > Date.now()
    );
  }
  private assertCurrent(generation: number): void {
    if (this.#destroyed || generation !== this.#generation) throw unavailable();
  }
  private clear(): void {
    if (this.expiryTimer !== undefined) clearTimeout(this.expiryTimer);
    this.expiryTimer = undefined;
    this.#session.set(null);
  }
  private endSession(): void {
    this.#initialized = true;
    ++this.#generation;
    this.clear();
    this.#restoreNeeded.set(false);
    this.#status.set('anonymous');
    this.#message.set('');
  }
  private fail(message: string): void {
    ++this.#generation;
    this.clear();
    this.#restoreNeeded.set(false);
    this.#status.set('unavailable');
    this.#message.set(message);
  }
  private receive(notice: SessionNotice): void {
    const wasLoggingOut = ['signing-out', 'logout-failed'].includes(this.#status());
    ++this.#generation;
    this.clear();
    if (notice === 'logout-completed') {
      this.endSession();
      return;
    }
    if (notice === 'logout-started') {
      this.#restoreNeeded.set(false);
      this.#status.set('signing-out');
      this.#message.set('Signing out in another tab…');
      return;
    }
    if (notice === 'session-unavailable') {
      this.#restoreNeeded.set(false);
      this.#status.set(wasLoggingOut ? 'logout-failed' : 'unavailable');
      this.#message.set(
        wasLoggingOut
          ? 'Could not sign out. Your session may still be active. Please retry sign out.'
          : 'Session access changed in another tab. Please sign in again.',
      );
      return;
    }
    if (wasLoggingOut) return;
    this.#restoreNeeded.set(true);
    this.#status.set('anonymous');
    this.#message.set('Your session changed in another tab. Open Account to check it.');
  }
}
