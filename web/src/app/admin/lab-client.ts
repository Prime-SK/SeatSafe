import { HttpClient, HttpContext, HttpErrorResponse } from '@angular/common/http';
import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { catchError, finalize, of, tap, throwError } from 'rxjs';
import { Authentication } from '../auth/authentication';
import { REQUIRES_AUTH } from '../auth/auth-interceptor';
export type LabScenario = 'seat-contention' | 'matching-key' | 'different-keys';
export interface LabAttempt {
  attempt: number;
  userLabel: string;
  outcome: string;
  code?: string;
}
export interface LabReport {
  runId: string;
  scenario: LabScenario;
  status: 'running' | 'completed' | 'failed' | 'incomplete';
  stage: string;
  startedAt: string;
  completedAt: string | null;
  postgres: string | null;
  isolation: string | null;
  requested: number;
  workers: number;
  attempts: LabAttempt[];
  successes: number;
  conflicts: Record<string, number>;
  timeouts: number;
  unexpected: number;
  undispatched: number;
  capacity: number;
  activeBookings: number | null;
  reservedSeats: number | null;
  idempotencyRecords: number | null;
  uniqueBookings: number;
  matchingSnapshots: boolean;
  invariantsPassed: boolean;
  cleanup: string;
  message: string;
}
export interface LabCapabilities {
  enabled: boolean;
  scenarios: LabScenario[];
}
const options = () => ({ context: new HttpContext().set(REQUIRES_AUTH, true) });
@Injectable({ providedIn: 'root' })
export class LabClient {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(Authentication);
  private readonly availabilityValue = signal<'checking' | 'enabled' | 'disabled' | 'error'>(
    'disabled',
  );
  readonly availability = this.availabilityValue.asReadonly();
  private readonly reportValue = signal<LabReport | null>(null);
  readonly report = this.reportValue.asReadonly();
  private readonly messageValue = signal('');
  readonly message = this.messageValue.asReadonly();
  private readonly pendingValue = signal(false);
  readonly pending = this.pendingValue.asReadonly();
  private readonly uncertainValue = signal(false);
  private readonly deniedValue = signal(false);
  readonly denied = this.deniedValue.asReadonly();
  readonly uncertain = this.uncertainValue.asReadonly();
  readonly enabled = computed(() => this.availabilityValue() === 'enabled');
  private identity = '';
  private capabilityFlight = '';
  constructor() {
    effect(() => {
      const account = this.auth.account(),
        status = this.auth.status(),
        generation = this.auth.currentGeneration();
      const identity =
        account?.role === 'ADMIN' &&
        !['anonymous', 'unavailable', 'signing-out', 'logout-failed'].includes(status)
          ? `${account.id}:${generation}`
          : '';
      untracked(() => {
        if (identity === this.identity) return;
        this.identity = identity;
        this.reportValue.set(null);
        this.messageValue.set('');
        this.uncertainValue.set(false);
        this.deniedValue.set(false);
        this.availabilityValue.set(identity ? 'checking' : 'disabled');
        if (identity) this.checkAvailability();
      });
    });
  }
  private current(owner: string, generation: number) {
    return (
      this.auth.account()?.id === owner &&
      this.auth.account()?.role === 'ADMIN' &&
      this.auth.currentGeneration() === generation &&
      this.auth.status() === 'signed-in'
    );
  }
  checkAvailability(): void {
    const owner = this.auth.account()?.id,
      generation = this.auth.currentGeneration();
    const flight = `${owner}:${generation}`;
    if (!owner || this.auth.account()?.role !== 'ADMIN' || this.capabilityFlight === flight) return;
    this.capabilityFlight = flight;
    this.availabilityValue.set('checking');
    this.http
      .get<LabCapabilities>('/api/admin/reliability/capabilities', options())
      .pipe(
        tap((value) => {
          if (this.current(owner, generation))
            this.availabilityValue.set(value.enabled ? 'enabled' : 'disabled');
        }),
        catchError(() => {
          if (this.current(owner, generation)) this.availabilityValue.set('error');
          return of(null);
        }),
        finalize(() => {
          if (this.capabilityFlight === flight) this.capabilityFlight = '';
        }),
      )
      .subscribe();
  }
  start(runId: string, scenario: LabScenario): void {
    const owner = this.auth.account()?.id,
      generation = this.auth.currentGeneration();
    if (
      !owner ||
      !this.current(owner, generation) ||
      !this.enabled() ||
      this.pendingValue() ||
      this.uncertainValue() ||
      this.reportValue()?.status === 'running'
    )
      return;
    this.pendingValue.set(true);
    this.reportValue.set(null);
    this.messageValue.set('');
    this.http
      .post<LabReport>('/api/admin/reliability/runs', { runId, scenario }, options())
      .pipe(
        tap((value) => {
          if (this.current(owner, generation)) this.reportValue.set(value);
        }),
        catchError((error: unknown) => {
          if (this.current(owner, generation)) {
            const status = error instanceof HttpErrorResponse ? error.status : 0;
            if (status === 403) {
              this.deniedValue.set(true);
              this.reportValue.set(null);
              this.availabilityValue.set('disabled');
            }
            this.uncertainValue.set(status === 0 || status >= 500);
            this.messageValue.set(
              status === 409
                ? 'The lab is busy or this run ID conflicts. Check status before starting a new run.'
                : status === 401 || status === 403
                  ? 'Administrator access could not authorize this run. Check your session.'
                  : status === 404
                    ? 'The reliability lab is not available in this session.'
                    : 'Starting the run could not be confirmed. Check status; the run may already be active.',
            );
          }
          return of(null);
        }),
        finalize(() => this.pendingValue.set(false)),
      )
      .subscribe();
  }
  read(runId: string) {
    const owner = this.auth.account()?.id,
      generation = this.auth.currentGeneration();
    return this.http
      .get<LabReport>(`/api/admin/reliability/runs/${encodeURIComponent(runId)}`, options())
      .pipe(
        tap((value) => {
          if (!owner || !this.current(owner, generation)) throw Error('Obsolete lab result');
          this.reportValue.set(value);
          this.messageValue.set('');
          this.uncertainValue.set(false);
        }),
        catchError((error: unknown) => {
          if (owner && this.current(owner, generation)) {
            const status = error instanceof HttpErrorResponse ? error.status : 0;
            if (status === 403) {
              this.deniedValue.set(true);
              this.reportValue.set(null);
              this.availabilityValue.set('disabled');
            }
            if (status === 404) {
              this.reportValue.set(null);
              this.uncertainValue.set(false);
            }
            this.messageValue.set(
              status === 404
                ? 'This run was not found. Reports are temporary and may be removed after restart or newer runs. Start a new run deliberately.'
                : 'Run status is unavailable. Polling is paused; check status when the service is available.',
            );
          }
          return throwError(() => error);
        }),
      );
  }
  clearMessage(): void {
    this.messageValue.set('');
  }
}
