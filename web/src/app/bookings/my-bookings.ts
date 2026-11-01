import { Component, effect, inject, signal, untracked } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { TagModule } from 'primeng/tag';
import { MessageModule } from 'primeng/message';
import { SkeletonModule } from 'primeng/skeleton';
import { PaginatorModule, PaginatorState } from 'primeng/paginator';
import { Authentication } from '../auth/authentication';
import { WorkshopDatePipe } from '../workshops/workshop-date.pipe';
import { Bookings, bookingReadError } from './bookings';
import { BookingPage } from './booking';
import { CancelBooking } from './cancel-booking';
type State =
  { kind: 'loading' } | { kind: 'ready'; data: BookingPage } | { kind: 'error'; message: string };
export function bookingPagination(
  page: string | null,
  limit: string | null,
): { page: number; limit: number } {
  const integer = (value: string | null, fallback: number, max: number) =>
    value &&
    /^\d+$/.test(value) &&
    Number.isSafeInteger(Number(value)) &&
    Number(value) >= 1 &&
    Number(value) <= max
      ? Number(value)
      : fallback;
  const size = integer(limit, 25, 100);
  return {
    page: integer(page, 1, 2147483647),
    limit: [10, 25, 50, 100].includes(size) ? size : 25,
  };
}
@Component({
  selector: 'app-my-bookings',
  imports: [
    RouterLink,
    WorkshopDatePipe,
    ButtonModule,
    CardModule,
    TagModule,
    MessageModule,
    SkeletonModule,
    PaginatorModule,
    CancelBooking,
  ],
  templateUrl: './my-bookings.html',
  styleUrl: './my-bookings.css',
})
export class MyBookings {
  protected readonly auth = inject(Authentication);
  protected readonly store = inject(Bookings);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  protected readonly state = signal<State>({ kind: 'loading' });
  private readonly params = signal(
    { page: 1, limit: 25 },
    { equal: (a, b) => a.page === b.page && a.limit === b.limit },
  );
  private readonly retryCount = signal(0);
  private owner: string | null = null;
  private generation = this.auth.currentGeneration();
  constructor() {
    this.route.queryParamMap.pipe(takeUntilDestroyed()).subscribe((query) => {
      const value = bookingPagination(
        query.getAll('page').length > 1 ? null : query.get('page'),
        query.getAll('limit').length > 1 ? null : query.get('limit'),
      );
      this.params.set(value);
      if (
        query.get('page') !== String(value.page) ||
        query.get('limit') !== String(value.limit) ||
        query.keys.some((key) => !['page', 'limit'].includes(key)) ||
        query.getAll('page').length > 1 ||
        query.getAll('limit').length > 1
      ) {
        void this.router.navigate([], {
          relativeTo: this.route,
          queryParams: value,
          replaceUrl: true,
        });
      }
    });
    effect((cleanup) => {
      const owner = this.auth.account()?.id ?? null,
        status = this.auth.status();
      const params = this.params();
      this.store.revision();
      this.retryCount();
      const pending = this.store.anyPending();
      if (owner !== this.owner || this.generation !== this.auth.currentGeneration())
        this.state.set({ kind: 'loading' });
      this.owner = owner;
      this.generation = this.auth.currentGeneration();
      if (!owner || status !== 'signed-in' || pending) return;
      this.state.set({ kind: 'loading' });
      const subscription = untracked(() => this.store.list(params.page, params.limit)).subscribe({
        next: (data) => this.state.set({ kind: 'ready', data }),
        error: (error) => this.state.set({ kind: 'error', message: bookingReadError(error) }),
      });
      cleanup(() => subscription.unsubscribe());
    });
  }
  protected retry(): void {
    this.retryCount.update((value) => value + 1);
  }
  protected pageChanged(event: PaginatorState): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { page: (event.page ?? 0) + 1, limit: event.rows ?? 25 },
    });
  }
  protected retryCancel(): void {
    const operation = this.store.notice();
    if (operation?.kind === 'uncertain-cancel' && operation.bookingId)
      this.store.cancel({ id: operation.bookingId, workshopId: operation.workshopId });
  }
}
