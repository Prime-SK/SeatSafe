import { HttpClient, HttpContext, HttpErrorResponse } from '@angular/common/http';
import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { catchError, defer, finalize, of, switchMap, tap } from 'rxjs';
import { Authentication } from '../auth/authentication';
import { REQUIRES_AUTH } from '../auth/auth-interceptor';
import { AdminAccess } from './admin-access';
export interface AdminUser {
  id: string;
  displayName: string;
  email: string;
  role: 'USER' | 'ADMIN';
  isEnabled: boolean;
}
export interface UserQuery {
  page: number;
  limit: number;
  search?: string;
  status?: 'enabled' | 'disabled';
}
export interface UserPage {
  items: AdminUser[];
  total: number;
  page: number;
  limit: number;
}
export interface UserNotice {
  kind: 'pending' | 'confirmed' | 'error' | 'uncertain';
  message: string;
}
const options = () => ({ context: new HttpContext().set(REQUIRES_AUTH, true) });
@Injectable({ providedIn: 'root' })
export class AdminUsers {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(Authentication);
  private readonly access = inject(AdminAccess);
  private readonly flight = signal(false);
  private readonly feedback = signal<UserNotice | null>(null);
  private readonly inspection = signal(false);
  readonly pending = this.flight.asReadonly();
  readonly notice = this.feedback.asReadonly();
  readonly needsInspection = this.inspection.asReadonly();
  readonly revision = signal(0);
  readonly canAct = computed(
    () =>
      !this.flight() &&
      !this.inspection() &&
      this.auth.status() === 'signed-in' &&
      this.auth.account()?.role === 'ADMIN',
  );
  private identity = '';
  constructor() {
    this.auth.logoutStarted.pipe(takeUntilDestroyed()).subscribe(() => this.clear());
    effect(() => {
      const account = this.auth.account(),
        status = this.auth.status(),
        generation = this.auth.currentGeneration();
      const identity =
        account?.role === 'ADMIN' &&
        !['signing-out', 'logout-failed', 'anonymous', 'unavailable'].includes(status)
          ? `${account.id}:${generation}`
          : '';
      untracked(() => {
        if (identity !== this.identity) {
          this.identity = identity;
          this.clear();
        }
      });
    });
  }
  private clear(): void {
    this.feedback.set(null);
    this.inspection.set(false);
    this.revision.update((v) => v + 1);
  }
  private current(owner: string, generation: number): boolean {
    return (
      this.auth.account()?.id === owner &&
      this.auth.account()?.role === 'ADMIN' &&
      this.auth.currentGeneration() === generation &&
      this.auth.status() === 'signed-in'
    );
  }
  list(query: UserQuery) {
    return defer(() => {
      const owner = this.auth.account()?.id,
        generation = this.auth.currentGeneration(),
        revision = this.revision();
      return this.http
        .get<UserPage>('/api/admin/users', { ...options(), params: { ...query } })
        .pipe(
          tap(() => {
            if (!owner || !this.current(owner, generation) || revision !== this.revision())
              throw Error('Obsolete account results');
            this.inspection.set(false);
          }),
          catchError((error: unknown) => {
            if (
              owner &&
              this.current(owner, generation) &&
              error instanceof HttpErrorResponse &&
              error.status === 403
            ) {
              this.clear();
              this.inspection.set(true);
              this.access.permissionLost();
            }
            throw error;
          }),
        );
    });
  }
  change(user: AdminUser, isEnabled: boolean): void {
    const owner = this.auth.account()?.id,
      generation = this.auth.currentGeneration();
    if (!owner || user.role !== 'USER' || !this.canAct()) return;
    this.flight.set(true);
    this.feedback.set({
      kind: 'pending',
      message: isEnabled ? 'Enabling account…' : 'Disabling account…',
    });
    this.revision.update((v) => v + 1);
    this.auth
      .ensureSession()
      .pipe(
        switchMap(() => {
          if (!this.current(owner, generation)) throw Error('Account changed');
          return this.http.patch<AdminUser>(
            `/api/admin/users/${encodeURIComponent(user.id)}/status`,
            { isEnabled },
            options(),
          );
        }),
        tap(() => {
          if (!this.current(owner, generation)) return;
          this.feedback.set({
            kind: 'confirmed',
            message: isEnabled
              ? 'Account enabled. Fresh sign-in is required. It may no longer match your filters.'
              : 'Account disabled and all sessions revoked. Bookings remain unchanged. It may no longer match your filters.',
          });
        }),
        catchError((error: unknown) => {
          if (!this.current(owner, generation)) return of(null);
          const status = error instanceof HttpErrorResponse ? error.status : 0;
          const code =
            error instanceof HttpErrorResponse
              ? (error.error?.code as string | undefined)
              : undefined;
          if (status === 403) {
            this.clear();
            this.inspection.set(true);
            this.access.permissionLost();
          } else if (status === 401)
            this.feedback.set({
              kind: 'error',
              message: 'Your session could not authorize this action. Please sign in again.',
            });
          else if (
            status === 400 ||
            (status === 404 && code === 'USER_NOT_FOUND') ||
            (status === 409 && code === 'ADMIN_ACCOUNT_PROTECTED')
          )
            this.feedback.set({
              kind: 'error',
              message:
                status === 404
                  ? 'This account could not be found. Reloading current users.'
                  : status === 409
                    ? 'Administrator accounts are protected. Reloading current users.'
                    : 'The status change could not be accepted. Reloading current users.',
            });
          else {
            this.inspection.set(true);
            this.feedback.set({
              kind: 'uncertain',
              message:
                'The status change could not be confirmed. Reload users and inspect current results before changing this account again.',
            });
          }
          return of(null);
        }),
        finalize(() => {
          this.flight.set(false);
          this.revision.update((v) => v + 1);
        }),
      )
      .subscribe();
  }
}
