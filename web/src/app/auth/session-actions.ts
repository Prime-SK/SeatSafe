import { Component, DestroyRef, inject } from '@angular/core';
import { Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';
import { Authentication } from './authentication';
@Component({
  selector: 'app-session-actions',
  imports: [ButtonModule, MessageModule],
  template: `
    @if (auth.account() || auth.status() === 'signing-out' || auth.status() === 'logout-failed') {
      <button
        pButton
        type="button"
        severity="secondary"
        variant="outlined"
        [disabled]="auth.status() === 'signing-out'"
        [loading]="auth.status() === 'signing-out'"
        (click)="logout()"
      >
        {{
          auth.status() === 'logout-failed'
            ? 'Retry sign out'
            : auth.status() === 'signing-out'
              ? 'Signing out…'
              : 'Sign out'
        }}
      </button>
    }
    @if (auth.status() === 'logout-failed') {
      <p-message severity="error" role="alert">{{ auth.message() }}</p-message>
    }
  `,
  styles: `
    :host {
      display: contents;
    }
    p-message {
      flex-basis: 100%;
      max-width: 32rem;
    }
  `,
})
export class SessionActions {
  protected readonly auth = inject(Authentication);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  protected logout(): void {
    this.auth
      .logout()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          void this.router.navigateByUrl('/workshops');
        },
        error: () => undefined,
      });
  }
}
