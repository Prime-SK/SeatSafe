import { DOCUMENT } from '@angular/common';
import { Component, effect, inject, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { EMPTY, catchError, exhaustMap, fromEvent, takeWhile, timer } from 'rxjs';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { LabelModule } from 'primeng/label';
import { MessageModule } from 'primeng/message';
import { SelectModule } from 'primeng/select';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { ProgressBarModule } from 'primeng/progressbar';
import { updatePreset } from '@primeuix/themes';
import progressbar from '@primeuix/themes/aura/progressbar';
import { Authentication } from '../auth/authentication';
import { LabClient, LabScenario } from './lab-client';
import { installUserTheme } from './user-theme';
import { AdminAccess } from './admin-access';
installUserTheme();
updatePreset({ components: { progressbar } });
@Component({
  selector: 'app-reliability-lab',
  imports: [
    FormsModule,
    ButtonModule,
    CardModule,
    LabelModule,
    MessageModule,
    SelectModule,
    TableModule,
    TagModule,
    ProgressBarModule,
  ],
  templateUrl: './reliability-lab.html',
  styleUrl: './reliability-lab.css',
})
export class ReliabilityLab {
  private readonly access = inject(AdminAccess);
  protected readonly lab = inject(LabClient);
  protected readonly auth = inject(Authentication);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly document = inject(DOCUMENT);
  protected readonly selected = signal<LabScenario>('seat-contention');
  protected readonly runId = signal('');
  protected readonly localMessage = signal('');
  private readonly retry = signal(0);
  private lastReadTrigger = '';
  private readonly visible = signal(this.document.visibilityState !== 'hidden');
  protected readonly scenarios = [
    { label: 'One-seat contention', value: 'seat-contention' },
    { label: 'Matching-key replay', value: 'matching-key' },
    { label: 'Different-key duplicates', value: 'different-keys' },
  ];
  protected readonly expected: Record<LabScenario, string> = {
    'seat-contention':
      '100 distinct users: 1 success, 99 full conflicts; one booking and reserved seat.',
    'matching-key':
      '20 matching submissions: 20 identical successes; one booking, reserved seat and outcome record.',
    'different-keys':
      '20 distinct keys for one user: 1 success, 19 already-booked conflicts; one booking and reserved seat.',
  };
  constructor() {
    effect(() => {
      if (this.lab.denied()) untracked(() => this.access.permissionLost());
    });
    fromEvent(this.document, 'visibilitychange')
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.visible.set(this.document.visibilityState !== 'hidden'));
    this.route.queryParamMap.pipe(takeUntilDestroyed()).subscribe((params) => {
      const id = params.get('run');
      if (
        id &&
        params.getAll('run').length === 1 &&
        /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id)
      ) {
        this.runId.set(id);
      } else {
        this.runId.set('');
        if (id) this.localMessage.set('The run link is invalid. Start a new run deliberately.');
      }
    });
    effect((cleanup) => {
      const id = this.runId(),
        enabled = this.lab.enabled(),
        pending = this.lab.pending(),
        visible = this.visible(),
        retry = this.retry(),
        account = this.auth.account(),
        status = this.auth.status();
      if (
        !id ||
        !enabled ||
        pending ||
        !visible ||
        account?.role !== 'ADMIN' ||
        status !== 'signed-in'
      )
        return;
      const current = untracked(() => this.lab.report()),
        message = untracked(() => this.lab.message());
      const trigger = `${id}:${retry}`,
        deliberate = trigger !== this.lastReadTrigger;
      this.lastReadTrigger = trigger;
      if (message && !deliberate) return;
      if (current?.runId === id && current.status !== 'running' && !deliberate) return;
      const subscription = untracked(() =>
        timer(0, 1000)
          .pipe(
            exhaustMap(() => this.lab.read(id)),
            takeWhile((report) => report.status === 'running', true),
            catchError(() => EMPTY),
          )
          .subscribe(),
      );
      cleanup(() => subscription.unsubscribe());
    });
  }
  protected start(): void {
    if (
      !this.lab.enabled() ||
      this.lab.pending() ||
      this.lab.uncertain() ||
      this.lab.report()?.status === 'running'
    )
      return;
    let id: string;
    try {
      id = crypto.randomUUID();
    } catch {
      this.localMessage.set('Secure run IDs are unavailable. Use a current browser.');
      return;
    }
    this.localMessage.set('');
    this.lab.start(id, this.selected());
    void this.router.navigate([], { relativeTo: this.route, queryParams: { run: id } });
  }
  protected check(): void {
    this.lab.clearMessage();
    this.retry.update((value) => value + 1);
  }
}
