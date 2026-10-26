import {
  Component,
  DestroyRef,
  inject,
  signal,
  afterNextRender,
  ElementRef,
  Injector,
  viewChild,
} from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router, RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { InputTextModule } from 'primeng/inputtext';
import { InputPasswordModule } from 'primeng/inputpassword';
import { LabelModule } from 'primeng/label';
import { MessageModule } from 'primeng/message';
import { Authentication } from './authentication';

type Field = 'email' | 'password';
type LoginState = { status: 'idle' } | { status: 'pending' } | { status: 'error'; message: string };
@Component({
  selector: 'app-login',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    ButtonModule,
    CardModule,
    InputTextModule,
    InputPasswordModule,
    LabelModule,
    MessageModule,
  ],
  templateUrl: './login.html',
  styleUrl: './login.css',
})
export class Login {
  protected readonly auth = inject(Authentication);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly state = signal<LoginState>({ status: 'idle' });
  protected readonly submitted = signal(false);
  private readonly injector = inject(Injector);
  private readonly summary = viewChild<ElementRef<HTMLElement>>('errorSummary');
  protected readonly visiblePasswords = signal<Record<string, boolean>>({});
  protected togglePassword(field: string): void {
    this.visiblePasswords.update((current) => ({ ...current, [field]: !current[field] }));
  }
  protected errorEntries(): { field: Field; message: string }[] {
    return (Object.keys(this.form.controls) as Field[]).flatMap((field) => {
      const message = this.error(field);
      return message ? [{ field, message }] : [];
    });
  }
  private focusSummary(): void {
    afterNextRender(() => this.summary()?.nativeElement.focus(), { injector: this.injector });
  }
  protected focusField(event: Event, field: string): void {
    event.preventDefault();
    this.summary()
      ?.nativeElement.closest('form')
      ?.querySelector<HTMLInputElement>('[formControlName="' + field + '"]')
      ?.focus();
  }

  protected readonly serverErrors = signal<Partial<Record<Field, string>>>({});
  protected readonly form = new FormGroup({
    email: new FormControl('', {
      nonNullable: true,
      validators: [
        (control) => {
          const email = (control.value as string).trim().toLowerCase();
          return !email ||
            Array.from(email).length > 254 ||
            Validators.email(new FormControl(email))
            ? { email: true }
            : null;
        },
      ],
    }),
    password: new FormControl('', {
      nonNullable: true,
      validators: [
        (control) => {
          const length = Array.from(control.value as string).length;
          return length >= 1 && length <= 128 ? null : { length: true };
        },
      ],
    }),
  });
  constructor() {
    this.form.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.serverErrors.set({}));
    this.destroyRef.onDestroy(() => this.form.controls.password.reset(''));
  }
  protected error(field: Field): string | null {
    if (this.serverErrors()[field]) return this.serverErrors()[field]!;
    const control = this.form.controls[field];
    if (!control.touched && !this.submitted()) return null;
    if (!control.invalid) return null;
    if (field === 'email')
      return !control.value.trim()
        ? 'Enter your email address.'
        : 'Enter a valid email address of up to 254 characters.';
    return !control.value ? 'Enter your password.' : 'Use no more than 128 characters.';
  }
  protected submit(): void {
    if (this.state().status === 'pending' || this.auth.authenticated()) return;
    this.submitted.set(true);
    this.form.markAllAsTouched();
    if (this.form.invalid) {
      this.focusSummary();
      return;
    }
    this.serverErrors.set({});
    this.state.set({ status: 'pending' });
    const { email, password } = this.form.getRawValue();
    this.auth
      .login({ email: email.trim().toLowerCase(), password })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.state.set({ status: 'idle' });
          this.form.controls.password.reset('');
          void this.router.navigateByUrl('/workshops');
        },
        error: (error: unknown) => {
          let message = 'Unable to sign in. Please try again.';
          if (error instanceof HttpErrorResponse) {
            if (error.status === 400) {
              const fields: Partial<Record<Field, string>> = {};
              const body = error.error as { fieldErrors?: Record<string, unknown> } | null;
              for (const field of ['email', 'password'] as const)
                if (Array.isArray(body?.fieldErrors?.[field]))
                  fields[field] = `Please check your ${field}.`;
              this.serverErrors.set(fields);
              message = 'Please check your sign-in details.';
            } else if (error.status === 401) message = 'Invalid email or password.';
            else if (error.status === 403)
              message =
                'Sign-in is unavailable from this page. Please open SeatSafe and try again.';
            else if (error.status === 429)
              message = 'Too many sign-in attempts. Please try again later.';
            else if (error.status === 503)
              message = 'Sign-in is temporarily unavailable. Please try again later.';
            else if (error.status === 0)
              message = 'Unable to connect. Check your connection and try again.';
          }
          this.state.set({ status: 'error', message });
          if (this.errorEntries().length) this.focusSummary();
        },
      });
  }
}
