import { DOCUMENT } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import {
  Component,
  DestroyRef,
  ElementRef,
  HostListener,
  Injector,
  ViewChild,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ConfirmationService } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { DatePickerModule } from 'primeng/datepicker';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputTextModule } from 'primeng/inputtext';
import { LabelModule } from 'primeng/label';
import { MessageModule } from 'primeng/message';
import { SkeletonModule } from 'primeng/skeleton';
import { ToggleSwitchModule } from 'primeng/toggleswitch';
import { skip } from 'rxjs';
import { Authentication } from '../auth/authentication';
import { Workshop } from '../workshops/workshop';
import { WorkshopsApi } from '../workshops/workshops-api';
import { AdminAccess } from './admin-access';
import { AdminWorkshopsApi } from './admin-workshops-api';
import {
  Draft,
  WorkshopField,
  colomboWallDate,
  draftChanges,
  draftErrors,
  fields,
  parseWallText,
} from './workshop-draft';

@Component({
  selector: 'app-workshop-editor',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    ButtonModule,
    CardModule,
    ConfirmDialogModule,
    DatePickerModule,
    InputNumberModule,
    InputTextModule,
    LabelModule,
    MessageModule,
    SkeletonModule,
    ToggleSwitchModule,
  ],
  providers: [ConfirmationService],
  templateUrl: './workshop-editor.html',
  styleUrl: './workshop-editor.css',
})
export class WorkshopEditor {
  private readonly auth = inject(Authentication);
  private readonly access = inject(AdminAccess);
  private readonly api = inject(WorkshopsApi);
  private readonly saves = inject(AdminWorkshopsApi);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly confirm = inject(ConfirmationService);
  private readonly document = inject(DOCUMENT);
  private readonly injector = inject(Injector);
  private readonly destroyRef = inject(DestroyRef);
  private generation = this.auth.currentGeneration();
  private operation = 0;
  private destroyed = false;
  private completed = false;
  private leaveDecision: Promise<boolean> | undefined;
  private resolveLeave: ((value: boolean) => void) | undefined;
  protected id = this.route.snapshot.paramMap.get('id');
  protected readonly original = signal<Workshop | null>(null);
  protected readonly state = signal<'loading' | 'ready' | 'missing' | 'error'>(
    this.id ? 'loading' : 'ready',
  );
  protected readonly pending = signal(false);
  protected readonly submitted = signal(false);
  protected readonly message = signal('');
  protected readonly conflict = signal(false);
  protected readonly invalidDate = signal(false);
  protected readonly serverErrors = signal<Partial<Record<WorkshopField, string>>>({});
  protected readonly revision = signal(0);
  protected readonly form = new FormGroup({
    title: new FormControl('', { nonNullable: true }),
    capacity: new FormControl<number | null>(null),
    schedule: new FormControl<Date | string | null>(null),
    registrationOpen: new FormControl(true, { nonNullable: true }),
  });
  protected readonly errors = computed(() => {
    this.revision();
    return {
      ...draftErrors(this.form.getRawValue(), this.original(), this.invalidDate()),
      ...this.serverErrors(),
    };
  });
  protected readonly errorEntries = computed(() =>
    fields
      .filter((field) => this.error(field))
      .map((field) => ({ field, message: this.error(field)! })),
  );
  protected readonly changed = computed(() => {
    this.revision();
    if (this.state() !== 'ready') return false;
    if (!this.id) {
      const value = this.form.getRawValue();
      return (
        !!value.title ||
        value.capacity !== null ||
        value.schedule !== null ||
        this.invalidDate() ||
        !value.registrationOpen
      );
    }
    return (
      this.invalidDate() ||
      Object.keys(draftChanges(this.form.getRawValue(), this.original())).length > 0
    );
  });
  @ViewChild('summary') private summary?: ElementRef<HTMLElement>;
  constructor() {
    this.form.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => {
      this.serverErrors.set({});
      this.revision.update((n) => n + 1);
    });
    effect(() => {
      const account = this.auth.account();
      this.auth.status();
      if (
        this.auth.currentGeneration() !== this.generation ||
        (account && account.role !== 'ADMIN')
      )
        this.discardForSecurity();
    });
    this.destroyRef.onDestroy(() => {
      this.destroyed = true;
      this.operation++;
      this.resolveLeave?.(false);
    });
    if (this.id) this.load();
    this.route.paramMap?.pipe(skip(1), takeUntilDestroyed()).subscribe((params) => {
      this.id = params.get('id');
      this.completed = false;
      this.original.set(null);
      this.form.reset({ title: '', capacity: null, schedule: null, registrationOpen: true });
      this.load();
    });
  }
  private current(): boolean {
    return (
      !this.destroyed &&
      this.generation === this.auth.currentGeneration() &&
      this.auth.account()?.role === 'ADMIN'
    );
  }
  private discardForSecurity(): void {
    if (this.completed) return;
    this.completed = true;
    this.operation++;
    this.form.reset({ title: '', capacity: null, schedule: null, registrationOpen: true });
    this.form.disable();
    this.confirm.close();
    this.resolveLeave?.(true);
    void this.router.navigateByUrl(
      this.auth.account()?.role === 'USER' ? '/admin/access' : '/workshops',
    );
  }
  protected error(field: WorkshopField): string | null {
    this.revision();
    return this.submitted() || this.form.controls[field].touched
      ? (this.errors()[field] ?? null)
      : null;
  }
  protected touch(field: WorkshopField): void {
    this.form.controls[field].markAsTouched();
    this.revision.update((n) => n + 1);
  }
  protected dateInput(event: Event): void {
    // PrimeNG may retain the last valid model while the text box contains an invalid date.
    const text = (event.target as HTMLInputElement).value;
    const date = parseWallText(text);
    this.invalidDate.set(date === null);
    if (date !== null) this.form.controls.schedule.setValue(date);
    this.revision.update((n) => n + 1);
  }
  protected selectDate(): void {
    this.invalidDate.set(false);
    this.revision.update((n) => n + 1);
  }
  protected focusField(event: Event, field: WorkshopField): void {
    event.preventDefault();
    this.document.getElementById(field)?.focus();
  }
  private focusSummary(): void {
    afterNextRender(
      () => {
        if (!this.destroyed) this.summary?.nativeElement.focus();
      },
      { injector: this.injector },
    );
  }
  protected load(): void {
    if (!this.id || !this.current()) return;
    const operation = ++this.operation;
    this.state.set('loading');
    this.api
      .getWorkshop(this.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (workshop) => {
          if (!this.current() || operation !== this.operation) return;
          this.original.set(workshop);
          this.form.reset({
            title: workshop.title,
            capacity: workshop.capacity,
            schedule: colomboWallDate(workshop.startsAt),
            registrationOpen: workshop.registrationOpen,
          });
          this.invalidDate.set(false);
          this.submitted.set(false);
          this.message.set('');
          this.conflict.set(false);
          this.state.set('ready');
          this.revision.update((n) => n + 1);
        },
        error: (error: unknown) => {
          if (this.current() && operation === this.operation)
            this.state.set(
              error instanceof HttpErrorResponse && error.status === 404 ? 'missing' : 'error',
            );
        },
      });
  }
  protected async reload(): Promise<void> {
    if (await this.confirmDiscard()) this.load();
  }
  protected async cancel(): Promise<void> {
    await this.router.navigateByUrl('/admin/workshops');
  }
  canLeave(): boolean | Promise<boolean> {
    if (this.completed || !this.current()) return true;
    if (this.pending()) return false;
    return this.confirmDiscard();
  }
  private confirmDiscard(): Promise<boolean> {
    if (!this.changed() || this.completed) return Promise.resolve(true);
    if (this.leaveDecision) return this.leaveDecision;
    this.leaveDecision = new Promise<boolean>((resolve) => {
      this.resolveLeave = resolve;
      this.confirm.confirm({
        header: 'Discard unsaved changes?',
        message: 'Your changes have not been saved.',
        acceptLabel: 'Discard changes',
        rejectLabel: 'Keep editing',
        defaultFocus: 'reject',
        acceptButtonProps: { severity: 'danger' },
        rejectButtonProps: { severity: 'secondary' },
        accept: () => resolve(true),
        reject: () => resolve(false),
      });
    }).finally(() => {
      this.leaveDecision = undefined;
      this.resolveLeave = undefined;
    });
    return this.leaveDecision;
  }
  @HostListener('window:beforeunload', ['$event'])
  protected warnBeforeUnload(event: BeforeUnloadEvent): void {
    if (this.current() && !this.completed && (this.pending() || this.changed())) {
      event.preventDefault();
      event.returnValue = '';
    }
  }
  protected submit(): void {
    if (this.pending() || !this.current() || (this.id && !this.changed())) return;
    this.submitted.set(true);
    this.form.markAllAsTouched();
    this.revision.update((n) => n + 1);
    this.serverErrors.set({});
    if (
      Object.keys(draftErrors(this.form.getRawValue(), this.original(), this.invalidDate())).length
    ) {
      this.focusSummary();
      return;
    }
    const input = draftChanges(this.form.getRawValue() as Draft, this.original());
    this.pending.set(true);
    this.form.disable({ emitEvent: false });
    this.message.set('');
    this.conflict.set(false);
    const operation = ++this.operation;
    this.saves
      .save(this.id, input)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          if (!this.current() || operation !== this.operation) return;
          this.completed = true;
          this.pending.set(false);
          this.form.reset();
          this.saves.notice.set(this.id ? 'Workshop updated.' : 'Workshop created.');
          void this.router.navigateByUrl('/admin/workshops');
        },
        error: (error: unknown) => {
          if (!this.current() || operation !== this.operation) return;
          this.pending.set(false);
          this.form.enable({ emitEvent: false });
          if (error instanceof HttpErrorResponse && error.status === 403) {
            this.completed = true;
            this.form.reset();
            this.form.disable();
            this.access.permissionLost();
            return;
          }
          let message = 'Unable to save the workshop. Please try again later.';
          if (error instanceof HttpErrorResponse) {
            if (error.status === 0)
              message =
                'Saving could not be confirmed. Inspect current workshops before repeating this save.';
            else if (error.status === 503)
              message =
                'Workshop management is temporarily unavailable. Your changes are still here.';
            else if (error.status === 404)
              message = 'This workshop no longer exists. Return to the workshop list.';
            else if (error.status === 409) {
              this.conflict.set(true);
              if (error.error?.code === 'CAPACITY_BELOW_RESERVED')
                this.serverErrors.set({
                  capacity:
                    'More seats are now reserved. Reload current values before choosing a capacity.',
                });
              else if (error.error?.code === 'WORKSHOP_ALREADY_STARTED')
                this.serverErrors.set({
                  registrationOpen:
                    'This workshop has started. Choose a future schedule before opening registration.',
                });
              message =
                'The workshop has changed or its schedule has started. Review your changes or reload current values.';
            } else if (error.status === 400) {
              const errors: Partial<Record<WorkshopField, string>> = {};
              for (const [key, field] of [
                ['title', 'title'],
                ['capacity', 'capacity'],
                ['startsAt', 'schedule'],
                ['registrationOpen', 'registrationOpen'],
              ] as const) {
                if (Array.isArray(error.error?.fieldErrors?.[key]))
                  errors[field] = 'Please check this value.';
              }
              this.serverErrors.set(errors);
              message = 'Please check the workshop details.';
            } else if (error.status === 429)
              message = 'Too many requests. Please wait before trying again.';
          }
          this.message.set(message);
          this.revision.update((n) => n + 1);
          this.focusSummary();
        },
      });
  }
}
