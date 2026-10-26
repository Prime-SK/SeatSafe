import { Component, DestroyRef, inject, signal } from '@angular/core';
import { HttpClient, HttpContext, HttpErrorResponse } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';
import { SkeletonModule } from 'primeng/skeleton';
import { Authentication } from './authentication';
import { AccountSummary } from './login-api';
import { REQUIRES_AUTH } from './auth-interceptor';
@Component({
  selector: 'app-account',
  imports: [RouterLink, CardModule, ButtonModule, MessageModule, SkeletonModule],
  template: `
    <header>
      <p class="eyebrow">Your SeatSafe account</p>
      <h1>Your account.</h1>
      <p class="intro">Your current account details.</p>
    </header>
    @if (auth.status() === 'checking') {
      <p role="status">Checking your session…</p>
    } @else if (auth.status() !== 'signed-in') {
      <section class="state-panel">
        <h2>
          {{
            auth.status() === 'logout-failed'
              ? 'Sign out needs another try'
              : auth.status() === 'signing-out'
                ? 'Signing out'
                : 'Session access is unavailable'
          }}
        </h2>
        <p>{{ auth.message() || 'Sign in to view your account.' }}</p>
        @if (auth.status() === 'signing-out' || auth.status() === 'logout-failed') {
          <p>Use the sign-out action above to retry if needed.</p>
          <a pButton routerLink="/workshops">Browse workshops</a>
        } @else {
          <a pButton routerLink="/login">Sign in</a>
        }
      </section>
    } @else if (state() === 'loading') {
      <p role="status" class="visually-hidden">Loading account…</p>
      <div aria-hidden="true"><p-skeleton height="12rem" /></div>
    } @else if (state() === 'error') {
      <section class="state-panel">
        <p-message severity="error" role="alert">{{ errorMessage() }}</p-message
        ><button pButton type="button" (click)="load()">Retry</button>
      </section>
    } @else if (auth.account(); as account) {
      <p-card
        ><dl>
          <div>
            <dt>Display name</dt>
            <dd>{{ account.displayName }}</dd>
          </div>
          <div>
            <dt>Email</dt>
            <dd>{{ account.email }}</dd>
          </div>
          <div>
            <dt>Role</dt>
            <dd>{{ account.role === 'ADMIN' ? 'Administrator' : 'User' }}</dd>
          </div>
        </dl></p-card
      >
    }
  `,
  styles: `
    :host {
      display: block;
      max-width: 48rem;
    }
    dl {
      display: grid;
      gap: 1.5rem;
      margin: 0;
    }
    dt {
      color: var(--muted);
      font-size: 0.875rem;
    }
    dd {
      margin: 0.25rem 0 0;
      overflow-wrap: anywhere;
      font-weight: 600;
    }
  `,
})
export class Account {
  protected readonly auth = inject(Authentication);
  private readonly http = inject(HttpClient);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly state = signal<'loading' | 'success' | 'error'>('loading');
  protected readonly errorMessage = signal('');
  private requestPending = false;
  constructor() {
    this.load();
  }
  protected load(): void {
    if (this.state() === 'loading' && this.requestPending) return;
    this.requestPending = true;
    this.state.set('loading');
    const generation = this.auth.currentGeneration();
    this.http
      .get<AccountSummary>('/api/auth/me', { context: new HttpContext().set(REQUIRES_AUTH, true) })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (profile) => {
          this.requestPending = false;
          if (generation !== this.auth.currentGeneration()) return;
          try {
            this.auth.updateProfile(profile, generation);
            this.state.set('success');
          } catch {
            this.errorMessage.set('Unable to load your account. Please try again.');
            this.state.set('error');
          }
        },
        error: (error: unknown) => {
          this.requestPending = false;
          this.errorMessage.set(
            error instanceof HttpErrorResponse && error.status === 503
              ? 'Your account is temporarily unavailable. Please try again.'
              : 'Unable to load your account. Please try again.',
          );
          this.state.set('error');
        },
      });
  }
}
