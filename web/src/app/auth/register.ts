import { Component, DestroyRef, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { InputTextModule } from 'primeng/inputtext';
import { InputPasswordModule } from 'primeng/inputpassword';
import { LabelModule } from 'primeng/label';
import { MessageModule } from 'primeng/message';
import { RegistrationApi } from './registration-api';
import { passwordsMatch, unicodeLength } from './registration.validators';

type RegistrationState =
  | { status: 'idle' }
  | { status: 'pending' }
  | { status: 'success' }
  | { status: 'error'; message: string };
type Field = 'displayName' | 'email' | 'password' | 'confirmation';
@Component({
  selector: 'app-register',
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
  templateUrl: './register.html',
  styleUrl: './register.css',
})
export class Register {
  private readonly api = inject(RegistrationApi);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly state = signal<RegistrationState>({ status: 'idle' });
  protected readonly submitted = signal(false);
  protected readonly serverErrors = signal<Partial<Record<Field, string>>>({});
  protected readonly form = new FormGroup(
    {
      displayName: new FormControl('', {
        nonNullable: true,
        validators: [unicodeLength(1, 100, true)],
      }),
      email: new FormControl('', {
        nonNullable: true,
        validators: [
          (control) =>
            Validators.email(
              new FormControl(
                typeof control.value === 'string'
                  ? control.value.trim().toLowerCase()
                  : control.value,
              ),
            ),
          unicodeLength(1, 254, true),
        ],
      }),
      password: new FormControl('', { nonNullable: true, validators: [unicodeLength(15, 128)] }),
      confirmation: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    },
    { validators: [passwordsMatch] },
  );
  constructor() {
    this.form.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.serverErrors.set({}));
  }
  protected error(field: Field): string | null {
    const control = this.form.controls[field];
    const server = this.serverErrors()[field];
    if (server) return server;
    if (!control.touched && !this.submitted()) return null;
    if (field === 'confirmation')
      return control.invalid || this.form.hasError('mismatch') ? 'Passwords must match.' : null;
    if (!control.invalid) return null;
    return field === 'displayName'
      ? 'Enter a name of 1–100 characters.'
      : field === 'email'
        ? 'Enter a valid email address of up to 254 characters.'
        : 'Use 15–128 characters, including at least one non-whitespace character.';
  }
  protected submit(): void {
    if (this.state().status === 'pending' || this.state().status === 'success') return;
    this.submitted.set(true);
    this.form.markAllAsTouched();
    if (this.form.invalid) return;
    this.serverErrors.set({});
    this.state.set({ status: 'pending' });
    const { displayName, email, password } = this.form.getRawValue();
    this.api
      .register({ displayName: displayName.trim(), email: email.trim().toLowerCase(), password })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.form.controls.password.reset('');
          this.form.controls.confirmation.reset('');
          this.form.disable();
          this.state.set({ status: 'success' });
        },
        error: (error: unknown) => {
          let message = 'Unable to create account. Please try again.';
          if (error instanceof HttpErrorResponse) {
            if (error.status === 409) {
              this.serverErrors.set({ email: 'An account with this email already exists.' });
              message = 'Please use a different email address.';
            } else if (error.status === 400) {
              const fields: Partial<Record<Field, string>> = {};
              const body = error.error as { fieldErrors?: Record<string, unknown> } | null;
              for (const field of ['displayName', 'email', 'password'] as const) {
                if (Array.isArray(body?.fieldErrors?.[field]))
                  fields[field] =
                    `Please check your ${field === 'displayName' ? 'display name' : field}.`;
              }
              this.serverErrors.set(fields);
              message = 'Please check the highlighted fields.';
            } else if (error.status === 429)
              message = 'Too many registration attempts. Please try again later.';
            else if (error.status === 503)
              message = 'Registration is temporarily unavailable. Please try again later.';
          }
          this.state.set({ status: 'error', message });
        },
      });
  }
}
