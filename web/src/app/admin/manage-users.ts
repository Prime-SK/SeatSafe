import { DOCUMENT } from '@angular/common';
import {
  Component,
  DestroyRef,
  afterEveryRender,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ConfirmationService } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { InputTextModule } from 'primeng/inputtext';
import { LabelModule } from 'primeng/label';
import { MessageModule } from 'primeng/message';
import { PaginatorModule, PaginatorState } from 'primeng/paginator';
import { SelectModule } from 'primeng/select';
import { SkeletonModule } from 'primeng/skeleton';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { Authentication } from '../auth/authentication';
import { AdminUsers, AdminUser, UserPage, UserQuery } from './admin-users';
import { installUserTheme } from './user-theme';
installUserTheme();
type State =
  | { kind: 'loading' | 'waiting' }
  | { kind: 'ready'; page: UserPage }
  | { kind: 'error'; message: string };
export function userQuery(params: {
  getAll(name: string): string[];
  get(name: string): string | null;
}): UserQuery {
  const one = (name: string) => (params.getAll(name).length === 1 ? params.get(name) : null);
  const integer = (value: string | null, fallback: number, max: number) =>
    value &&
    /^\d+$/.test(value) &&
    Number.isSafeInteger(Number(value)) &&
    Number(value) > 0 &&
    Number(value) <= max
      ? Number(value)
      : fallback;
  const limit = integer(one('limit'), 25, 100),
    search = one('search')?.trim(),
    status = one('status');
  return {
    page: integer(one('page'), 1, 2147483647),
    limit: [10, 25, 50, 100].includes(limit) ? limit : 25,
    ...(search && Array.from(search).length <= 200 ? { search } : {}),
    ...(status === 'enabled' || status === 'disabled' ? { status } : {}),
  };
}
@Component({
  selector: 'app-manage-users',
  imports: [
    RouterLink,
    ReactiveFormsModule,
    ButtonModule,
    CardModule,
    ConfirmDialogModule,
    InputTextModule,
    LabelModule,
    MessageModule,
    PaginatorModule,
    SelectModule,
    SkeletonModule,
    TableModule,
    TagModule,
  ],
  providers: [ConfirmationService],
  templateUrl: './manage-users.html',
  styleUrl: './manage-users.css',
})
export class ManageUsers {
  protected readonly auth = inject(Authentication);
  protected readonly store = inject(AdminUsers);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly document = inject(DOCUMENT);
  private readonly confirm = inject(ConfirmationService);
  protected readonly state = signal<State>({ kind: 'loading' });
  protected readonly query = signal<UserQuery>(
    { page: 1, limit: 25 },
    { equal: (a, b) => JSON.stringify(a) === JSON.stringify(b) },
  );
  protected readonly attempted = signal(false);
  protected readonly form = new FormGroup({
    search: new FormControl('', {
      nonNullable: true,
      validators: (control) =>
        Array.from((control.value as string).trim()).length > 200 ? { length: true } : null,
    }),
    status: new FormControl<'all' | 'enabled' | 'disabled'>('all', { nonNullable: true }),
  });
  protected readonly statuses = [
    { label: 'All accounts', value: 'all' },
    { label: 'Enabled', value: 'enabled' },
    { label: 'Disabled', value: 'disabled' },
  ];
  private readonly reload = signal(0);
  private lastReload = -1;
  private lastQuery = '';
  private owner = '';
  private trigger: HTMLElement | null = null;
  private openedGeneration = -1;
  private destroyed = false;
  private accepted = false;
  private focusAfterChange = false;
  constructor() {
    afterEveryRender(() => {
      if (!this.focusAfterChange || this.store.pending() || this.state().kind === 'loading') return;
      if (
        Array.from(this.document.querySelectorAll('[role="alertdialog"]')).some(
          (dialog) => dialog.getBoundingClientRect().width > 0,
        )
      )
        return;
      this.focusAfterChange = false;
      if (
        this.destroyed ||
        this.openedGeneration !== this.auth.currentGeneration() ||
        this.auth.account()?.role !== 'ADMIN' ||
        this.auth.status() !== 'signed-in'
      )
        return;
      const active = this.document.activeElement;
      if (active === this.document.body || active?.closest('p-confirmdialog')) {
        const heading = this.document.querySelector<HTMLElement>('main h1');
        heading?.setAttribute('tabindex', '-1');
        heading?.focus({ preventScroll: true });
      }
    });
    this.route.queryParamMap.pipe(takeUntilDestroyed()).subscribe((params) => {
      const query = userQuery(params);
      this.query.set(query);
      this.form.reset({ search: query.search ?? '', status: query.status ?? 'all' });
      this.attempted.set(false);
      const canonical: Record<string, string> = Object.fromEntries(
        Object.entries(query).map(([k, v]) => [k, String(v)]),
      );
      if (
        params.keys.length !== Object.keys(canonical).length ||
        params.keys.some((k) => params.getAll(k).length !== 1 || params.get(k) !== canonical[k])
      )
        void this.router.navigate([], {
          relativeTo: this.route,
          queryParams: query,
          replaceUrl: true,
        });
    });
    effect((cleanup) => {
      const account = this.auth.account(),
        status = this.auth.status(),
        generation = this.auth.currentGeneration(),
        query = this.query(),
        reload = this.reload();
      this.store.revision();
      const pending = this.store.pending();
      const owner = account?.role === 'ADMIN' ? `${account.id}:${generation}` : '';
      if (
        owner !== this.owner ||
        !owner ||
        ['signing-out', 'logout-failed', 'anonymous', 'unavailable'].includes(status)
      ) {
        this.state.set({ kind: 'waiting' });
        this.trigger = null;
        untracked(() => this.confirm.close());
      }
      this.owner = owner;
      if (!owner || status !== 'signed-in') return;
      const deliberate = reload !== this.lastReload || JSON.stringify(query) !== this.lastQuery;
      this.lastReload = reload;
      this.lastQuery = JSON.stringify(query);
      if (pending || (untracked(() => this.store.needsInspection()) && !deliberate)) {
        this.state.set({ kind: 'waiting' });
        return;
      }
      this.state.set({ kind: 'loading' });
      const subscription = untracked(() =>
        this.store.list(query).subscribe({
          next: (page) => {
            const notice = this.store.notice();
            if (
              !page.items.length &&
              query.page > Math.max(1, Math.ceil(page.total / query.limit)) &&
              notice?.kind === 'confirmed'
            ) {
              void this.router.navigate([], {
                relativeTo: this.route,
                queryParams: { ...query, page: Math.max(1, Math.ceil(page.total / query.limit)) },
                replaceUrl: true,
              });
              return;
            }
            this.state.set({ kind: 'ready', page });
          },
          error: () =>
            this.state.set({
              kind: 'error',
              message:
                this.store.notice()?.kind === 'confirmed'
                  ? 'The status change completed, but current users could not be loaded. Reload users to check the latest results.'
                  : 'Users are temporarily unavailable. Please reload and try again.',
            }),
        }),
      );
      cleanup(() => subscription.unsubscribe());
    });
    inject(DestroyRef).onDestroy(() => {
      this.destroyed = true;
      this.confirm.close();
      this.restoreFocus();
    });
  }
  protected apply(): void {
    this.attempted.set(true);
    if (this.form.invalid) {
      this.document.getElementById('user-search')?.focus();
      return;
    }
    const { search, status } = this.form.getRawValue();
    this.navigate({
      page: 1,
      limit: this.query().limit,
      ...(search.trim() ? { search: search.trim() } : {}),
      ...(status !== 'all' ? { status } : {}),
    });
  }
  protected clear(): void {
    this.form.reset({ search: '', status: 'all' });
    this.attempted.set(false);
    this.navigate({ page: 1, limit: 25 });
  }
  private navigate(query: UserQuery): void {
    if (JSON.stringify(query) === JSON.stringify(this.query())) this.load();
    else void this.router.navigate([], { relativeTo: this.route, queryParams: query });
  }
  protected load(): void {
    this.openedGeneration = this.auth.currentGeneration();
    this.focusAfterChange = true;
    this.reload.update((v) => v + 1);
  }
  protected pageChanged(event: PaginatorState): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { ...this.query(), page: (event.page ?? 0) + 1, limit: event.rows ?? 25 },
    });
  }
  protected change(user: AdminUser, event: Event): void {
    if (!this.store.canAct() || user.role !== 'USER') return;
    if (!user.isEnabled) {
      this.openedGeneration = this.auth.currentGeneration();
      this.focusAfterChange = true;
      this.store.change(user, true);
      return;
    }
    const generation = this.auth.currentGeneration();
    this.accepted = false;
    this.openedGeneration = generation;
    this.trigger = event.currentTarget as HTMLElement;
    this.confirm.confirm({
      header: 'Disable this account?',
      message: `Disable ${user.displayName} (${user.email})? All sessions will be revoked. Existing bookings will remain.`,
      defaultFocus: 'reject',
      rejectButtonProps: { label: 'Keep enabled', severity: 'secondary' },
      acceptButtonProps: { label: 'Disable account', severity: 'danger' },
      accept: () => {
        if (
          !this.destroyed &&
          generation === this.auth.currentGeneration() &&
          this.store.canAct()
        ) {
          this.accepted = true;
          this.focusAfterChange = true;
          this.store.change(user, false);
        }
      },
    });
  }
  protected restoreFocus(): void {
    const trigger = this.trigger;
    this.trigger = null;
    if (this.accepted) {
      this.accepted = false;
      return;
    }
    queueMicrotask(() => {
      if (
        this.destroyed ||
        this.openedGeneration !== this.auth.currentGeneration() ||
        this.auth.account()?.role !== 'ADMIN' ||
        this.auth.status() !== 'signed-in'
      )
        return;
      if (trigger?.isConnected && !(trigger instanceof HTMLButtonElement && trigger.disabled))
        trigger.focus();
      else {
        const heading = this.document.querySelector<HTMLElement>('main h1');
        heading?.setAttribute('tabindex', '-1');
        heading?.focus();
      }
    });
  }
}
