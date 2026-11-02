import { HttpClient, HttpContext, HttpErrorResponse } from '@angular/common/http';
import { Component, effect, inject, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { forkJoin } from 'rxjs';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { MessageModule } from 'primeng/message';
import { SkeletonModule } from 'primeng/skeleton';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { PaginatorModule, PaginatorState } from 'primeng/paginator';
import { Authentication } from '../auth/authentication';
import { REQUIRES_AUTH } from '../auth/auth-interceptor';
import { Workshop } from '../workshops/workshop';
import { WorkshopDatePipe } from '../workshops/workshop-date.pipe';
import { WorkshopsApi } from '../workshops/workshops-api';
import { AdminAccess } from './admin-access';
import { installUserTheme } from './user-theme';
installUserTheme();
export interface AttendeeBooking {
  id: string;
  workshopId: string;
  status: 'ACTIVE' | 'CANCELLED';
  createdAt: string;
  cancelledAt: string | null;
  user: { id: string; displayName: string; email: string };
}
export interface AttendeePage {
  items: AttendeeBooking[];
  total: number;
  page: number;
  limit: number;
}
type State =
  | { kind: 'waiting' | 'loading' }
  | { kind: 'ready'; workshop: Workshop; data: AttendeePage }
  | { kind: 'missing' | 'error'; message: string };
export function attendeePagination(page: string | null, limit: string | null) {
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
  selector: 'app-workshop-bookings',
  imports: [
    RouterLink,
    WorkshopDatePipe,
    ButtonModule,
    CardModule,
    MessageModule,
    SkeletonModule,
    TableModule,
    TagModule,
    PaginatorModule,
  ],
  templateUrl: './workshop-bookings.html',
  styleUrl: './workshop-bookings.css',
})
export class WorkshopBookings {
  private readonly http = inject(HttpClient);
  private readonly workshops = inject(WorkshopsApi);
  protected readonly auth = inject(Authentication);
  private readonly access = inject(AdminAccess);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  protected readonly state = signal<State>({ kind: 'waiting' });
  private readonly id = signal('');
  private readonly pagination = signal(
    { page: 1, limit: 25 },
    { equal: (a, b) => a.page === b.page && a.limit === b.limit },
  );
  private readonly revision = signal(0);
  constructor() {
    this.route.paramMap
      .pipe(takeUntilDestroyed())
      .subscribe((params) => this.id.set(params.get('id') ?? ''));
    this.route.queryParamMap.pipe(takeUntilDestroyed()).subscribe((query) => {
      const value = attendeePagination(
        query.getAll('page').length === 1 ? query.get('page') : null,
        query.getAll('limit').length === 1 ? query.get('limit') : null,
      );
      this.pagination.set(value);
      if (
        query.get('page') !== String(value.page) ||
        query.get('limit') !== String(value.limit) ||
        query.keys.some((key) => !['page', 'limit'].includes(key)) ||
        query.getAll('page').length !== 1 ||
        query.getAll('limit').length !== 1
      )
        void this.router.navigate([], {
          relativeTo: this.route,
          queryParams: value,
          replaceUrl: true,
        });
    });
    effect((cleanup) => {
      const account = this.auth.account(),
        status = this.auth.status(),
        id = this.id(),
        params = this.pagination();
      this.revision();
      this.state.set({ kind: 'waiting' });
      if (!id || account?.role !== 'ADMIN' || status !== 'signed-in') return;
      const generation = this.auth.currentGeneration();
      this.state.set({ kind: 'loading' });
      const subscription = untracked(() =>
        forkJoin({
          workshop: this.workshops.getWorkshop(id),
          data: this.http.get<AttendeePage>(
            `/api/admin/workshops/${encodeURIComponent(id)}/bookings`,
            { params, context: new HttpContext().set(REQUIRES_AUTH, true) },
          ),
        }),
      ).subscribe({
        next: (result) => {
          if (
            generation === this.auth.currentGeneration() &&
            this.auth.account()?.id === account.id &&
            this.auth.account()?.role === 'ADMIN' &&
            this.auth.status() === 'signed-in'
          )
            this.state.set({ kind: 'ready', ...result });
        },
        error: (error: unknown) => {
          if (
            generation !== this.auth.currentGeneration() ||
            this.auth.account()?.id !== account.id
          )
            return;
          const code = error instanceof HttpErrorResponse ? error.status : 0;
          this.state.set(
            code === 404
              ? { kind: 'missing', message: 'This workshop could not be found.' }
              : {
                  kind: 'error',
                  message:
                    code === 401
                      ? 'Sign in again to view workshop bookings.'
                      : code === 403
                        ? 'Administrator permission is required.'
                        : 'Workshop bookings are unavailable. Please try again.',
                },
          );
          if (code === 403) untracked(() => this.access.permissionLost());
        },
      });
      cleanup(() => subscription.unsubscribe());
    });
  }
  protected retry() {
    this.revision.update((value) => value + 1);
  }
  protected pageChanged(event: PaginatorState) {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { page: (event.page ?? 0) + 1, limit: event.rows ?? 25 },
    });
  }
}
