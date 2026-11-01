import { HttpClient, HttpContext, HttpErrorResponse } from '@angular/common/http';
import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { SessionCoordinator } from '../auth/session-coordinator';
import {
  Observable,
  catchError,
  defer,
  finalize,
  of,
  shareReplay,
  switchMap,
  tap,
  throwError,
} from 'rxjs';
import { Authentication } from '../auth/authentication';
import { REQUIRES_AUTH } from '../auth/auth-interceptor';
import { Booking, BookingItem, BookingPage } from './booking';
import { ReservationKeyError, ReservationKeys } from './reservation-keys';

export interface BookingOperation {
  message: string;
  kind:
    | 'pending'
    | 'confirmed-reserve'
    | 'confirmed-cancel'
    | 'error'
    | 'uncertain-reserve'
    | 'uncertain-cancel'
    | 'blocked';
  bookingId?: string;
}
export class ObsoleteBookingRead extends Error {}
export function bookingReadError(error: unknown): string {
  if (error instanceof HttpErrorResponse && error.status === 401)
    return 'Please sign in again to view your bookings.';
  return error instanceof HttpErrorResponse && error.status === 0
    ? 'Unable to connect. Check your connection and try again.'
    : 'Your bookings are temporarily unavailable. Please try again.';
}
@Injectable({ providedIn: 'root' })
export class Bookings {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(Authentication);
  private readonly keys = inject(ReservationKeys);
  private readonly flights = new Map<string, object>();
  private readonly lookups = new Map<string, Observable<BookingItem | null>>();
  private readonly operations = signal<Record<string, BookingOperation>>({});
  private readonly pendingIds = signal<string[]>([]);
  private readonly lastOperation = signal('');
  readonly notice = computed(() => {
    const owner = this.owner(),
      id = this.lastOperation();
    return owner && id.startsWith(`${owner}:`) && this.operations()[id]
      ? { ...this.operations()[id], workshopId: id.slice(owner.length + 1) }
      : null;
  });
  readonly revision = signal(0);
  readonly anyPending = computed(() => {
    const owner = this.owner();
    return !!owner && this.pendingIds().some((id) => id.startsWith(`${owner}:`));
  });
  private lastAccount: string | null = this.owner();
  private lastGeneration = this.auth.currentGeneration();
  constructor() {
    this.auth.logoutStarted.pipe(takeUntilDestroyed()).subscribe(() => {
      this.keys.clear();
      this.operations.set({});
    });
    inject(SessionCoordinator)
      .notices.pipe(takeUntilDestroyed())
      .subscribe((notice) => {
        if (notice === 'logout-started') {
          this.keys.clear();
          this.operations.set({});
        }
      });
    effect(() => {
      const account = this.auth.account()?.id ?? null;
      const status = this.auth.status();
      const generation = this.auth.currentGeneration();
      untracked(() => {
        if (status === 'signing-out' || status === 'logout-failed') this.keys.clear();
        if (account) this.keys.retainAccount(account);
        if ((account && this.lastAccount !== account) || generation !== this.lastGeneration) {
          this.lookups.clear();
          this.operations.set({});
          this.revision.update((value) => value + 1);
        }
        if (account) this.lastAccount = account;
        this.lastGeneration = generation;
      });
    });
  }
  private owner(): string | null {
    return this.auth.account()?.id ?? null;
  }
  private identity(workshopId: string, owner = this.owner()): string {
    return `${owner ?? ''}:${workshopId}`;
  }
  pending(workshopId: string): boolean {
    return this.pendingIds().includes(this.identity(workshopId));
  }
  operation(workshopId: string): BookingOperation | undefined {
    return this.operations()[this.identity(workshopId)];
  }
  private publish(id: string, value: BookingOperation): void {
    this.operations.update((all) => ({ ...all, [id]: value }));
    this.lastOperation.set(id);
  }
  private options() {
    return { context: new HttpContext().set(REQUIRES_AUTH, true) };
  }
  private current(owner: string, generation: number): boolean {
    return (
      this.owner() === owner &&
      this.auth.currentGeneration() === generation &&
      this.auth.status() === 'signed-in'
    );
  }
  private assertCurrent(owner: string, generation: number): void {
    if (!this.current(owner, generation)) throw new ObsoleteBookingRead();
  }
  list(page = 1, limit = 25): Observable<BookingPage> {
    return defer(() => {
      const owner = this.owner(),
        generation = this.auth.currentGeneration(),
        revision = this.revision();
      if (!owner) return throwError(() => new ObsoleteBookingRead());
      return this.http
        .get<BookingPage>('/api/bookings/me', { ...this.options(), params: { page, limit } })
        .pipe(
          tap(() => {
            this.assertCurrent(owner, generation);
            if (revision !== this.revision()) throw new ObsoleteBookingRead();
          }),
        );
    });
  }
  findActive(workshopId: string): Observable<BookingItem | null> {
    const id = `${this.identity(workshopId)}:${this.auth.currentGeneration()}:${this.revision()}`;
    const existing = this.lookups.get(id);
    if (existing) return existing;
    const scan = (page: number): Observable<BookingItem | null> =>
      this.list(page, 100).pipe(
        switchMap((result) => {
          const found = result.items.find(
            (row) => row.workshopId === workshopId && row.status === 'ACTIVE',
          );
          return found
            ? of(found)
            : result.items.length > 0 && page * 100 < result.total
              ? scan(page + 1)
              : of(null);
        }),
      );
    let stream: Observable<BookingItem | null>;
    stream = defer(() => scan(1)).pipe(
      finalize(() => {
        if (this.lookups.get(id) === stream) this.lookups.delete(id);
      }),
      shareReplay({ bufferSize: 1, refCount: true }),
    );
    this.lookups.set(id, stream);
    return stream;
  }
  pendingKey(workshopId: string): string | null {
    const owner = this.owner();
    return owner ? this.keys.peek(owner, workshopId) : null;
  }
  resetKey(workshopId: string): boolean {
    const owner = this.owner();
    if (!owner || this.pending(workshopId) || !this.keys.remove(owner, workshopId)) return false;
    this.publish(this.identity(workshopId), {
      kind: 'error',
      message:
        'Saved request cleared. Check the current booking status before starting a new attempt.',
    });
    this.refresh();
    return true;
  }
  refresh(): void {
    this.lookups.clear();
    this.revision.update((value) => value + 1);
  }
  reserve(workshopId: string): void {
    this.write(workshopId);
  }
  cancel(booking: Pick<Booking, 'id' | 'workshopId'>): void {
    this.write(booking.workshopId, booking.id);
  }
  private write(workshopId: string, bookingId?: string): void {
    const owner = this.owner(),
      generation = this.auth.currentGeneration();
    if (!owner || this.auth.status() !== 'signed-in') return;
    const id = this.identity(workshopId, owner);
    if (this.flights.has(id)) return;
    const marker = {};
    this.flights.set(id, marker);
    this.pendingIds.set([...this.flights.keys()]);
    this.publish(id, {
      kind: 'pending',
      message: bookingId ? 'Cancelling your booking…' : 'Reserving your seat…',
    });
    this.refresh();
    let key: string | undefined;
    this.auth
      .ensureSession()
      .pipe(
        switchMap(() => {
          this.assertCurrent(owner, generation);
          if (bookingId)
            return this.http.post<Booking>(
              `/api/bookings/${encodeURIComponent(bookingId)}/cancel`,
              {},
              this.options(),
            );
          key = this.keys.obtain(owner, workshopId);
          return this.http.post<Booking>(
            `/api/workshops/${encodeURIComponent(workshopId)}/bookings`,
            {},
            { ...this.options(), headers: { 'Idempotency-Key': key } },
          );
        }),
        tap(() => {
          this.assertCurrent(owner, generation);
          const removed = !key || this.keys.remove(owner, workshopId, key);
          this.publish(id, {
            kind: !removed ? 'blocked' : bookingId ? 'confirmed-cancel' : 'confirmed-reserve',
            message: removed
              ? bookingId
                ? 'Your booking has been cancelled.'
                : 'Reservation request completed. Checking your current booking…'
              : 'Request completed, but the saved request could not be cleared. Check your bookings before trying again.',
          });
        }),
        catchError((error: unknown) => {
          if (!this.current(owner, generation)) return of(null);
          if (error instanceof ReservationKeyError) {
            this.publish(id, {
              kind: error.resettable ? 'blocked' : 'error',
              message: error.resettable
                ? 'This saved reservation needs review. Check your bookings before clearing it.'
                : 'Reservations are unavailable in this browser session. Allow site storage and use a current browser, then try again.',
            });
            return of(null);
          }
          const status = error instanceof HttpErrorResponse ? error.status : -1;
          const code =
            error instanceof HttpErrorResponse
              ? (error.error?.code as string | undefined)
              : undefined;
          const messages: Record<string, string> = {
            ALREADY_BOOKED:
              'You already have a booking for this workshop. Check your current bookings.',
            REGISTRATION_CLOSED: 'Registration is closed for this workshop.',
            WORKSHOP_ALREADY_STARTED: 'This workshop has already started.',
            WORKSHOP_FULL: 'This workshop is full. You can check availability again later.',
            WORKSHOP_NOT_FOUND: 'This workshop could not be found.',
            BOOKING_NOT_FOUND:
              'This booking could not be found for your account. Reload your bookings.',
            VALIDATION_FAILED:
              'The request could not be accepted. Reload the current information and try again.',
          };
          if (code === 'IDEMPOTENCY_KEY_CONFLICT') {
            this.publish(id, {
              kind: 'blocked',
              message:
                'This saved request belongs to a different attempt. Check your bookings before clearing it.',
            });
          } else if ([400, 404, 409].includes(status) && code && messages[code]) {
            const removed = !key || this.keys.remove(owner, workshopId, key);
            this.publish(id, {
              kind: removed ? 'error' : 'blocked',
              message: removed
                ? messages[code]
                : `${messages[code]} The saved request could not be cleared. Check your bookings before clearing it.`,
            });
          } else if (status === 401 || status === 403 || status === 429) {
            this.publish(id, {
              kind: 'error',
              message:
                status === 429
                  ? 'Too many requests. Please wait before trying again.'
                  : 'This action is unavailable. Please check your session and sign in again.',
            });
          } else {
            this.publish(id, {
              kind: bookingId ? 'uncertain-cancel' : 'uncertain-reserve',
              bookingId,
              message: bookingId
                ? 'Cancellation could not be confirmed. Check your bookings or retry cancellation.'
                : 'Your reservation could not be confirmed. Check your bookings or retry this reservation.',
            });
          }
          return of(null);
        }),
        finalize(() => {
          if (this.flights.get(id) === marker) this.flights.delete(id);
          this.pendingIds.set([...this.flights.keys()]);
          this.refresh();
        }),
      )
      .subscribe();
  }
}
