import { HttpClient, HttpContext, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { catchError, map, of, switchMap } from 'rxjs';
import { Authentication } from '../auth/authentication';
import { REQUIRES_AUTH } from '../auth/auth-interceptor';
import { AccountSummary } from '../auth/login-api';

@Injectable({ providedIn: 'root' })
export class AdminAccess {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(Authentication);
  private readonly router = inject(Router);
  readonly message = signal('Administrator access is required to manage SeatSafe.');
  readonly retryable = signal(false);
  private destination = '/admin/workshops';
  check(destination: string) {
    this.destination =
      /^\/admin\/(?:reliability|users|workshops(?:\/new|\/[^/?#]+\/(?:edit|bookings))?)(?:\?[^#]*)?$/.test(
        destination,
      )
        ? destination
        : '/admin/workshops';
    return this.auth.ensureSession().pipe(
      switchMap(() => {
        const generation = this.auth.currentGeneration();
        return this.http
          .get<AccountSummary>('/api/auth/me', {
            context: new HttpContext().set(REQUIRES_AUTH, true),
          })
          .pipe(
            map((profile) => {
              if (generation !== this.auth.currentGeneration())
                return this.router.createUrlTree(['/login']);
              this.auth.updateProfile(profile, generation);
              if (profile.role === 'ADMIN') return true;
              this.denied();
              return this.router.createUrlTree(['/admin/access']);
            }),
          );
      }),
      catchError((error: unknown) => {
        if (
          (error instanceof HttpErrorResponse && error.status === 401) ||
          this.auth.status() === 'anonymous'
        )
          return of(this.router.createUrlTree(['/login']));
        this.retryable.set(true);
        this.message.set(
          'Administrator access could not be checked. Please try again when the service is available.',
        );
        return of(this.router.createUrlTree(['/admin/access']));
      }),
    );
  }
  denied(): void {
    this.retryable.set(false);
    this.message.set('Your account does not have permission to manage SeatSafe.');
  }
  permissionLost(): void {
    this.denied();
    // The component clears its draft immediately. Re-read presentation without retrying the write.
    const generation = this.auth.currentGeneration();
    this.http
      .get<AccountSummary>('/api/auth/me', { context: new HttpContext().set(REQUIRES_AUTH, true) })
      .subscribe({
        next: (profile) => this.auth.updateProfile(profile, generation),
        error: () => undefined,
      });
    void this.router.navigateByUrl('/admin/access');
  }
  retry(): void {
    void this.router.navigateByUrl(this.destination);
  }
}
export const adminGuard: CanActivateFn = (_route, state) => inject(AdminAccess).check(state.url);
