import { Component, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import {
  Subject,
  catchError,
  combineLatest,
  distinctUntilChanged,
  map,
  of,
  startWith,
  switchMap,
} from 'rxjs';
import { Workshop } from './workshop';
import { WorkshopsApi } from './workshops-api';
import { WorkshopDatePipe } from './workshop-date.pipe';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { TagModule } from 'primeng/tag';
import { MessageModule } from 'primeng/message';
import { ProgressSpinnerModule } from 'primeng/progressspinner';

type DetailState =
  | { status: 'loading' }
  | { status: 'success'; workshop: Workshop }
  | { status: 'not-found' }
  | { status: 'error'; message: string };

@Component({
  selector: 'app-workshop-detail',
  imports: [
    RouterLink,
    WorkshopDatePipe,
    ButtonModule,
    CardModule,
    TagModule,
    MessageModule,
    ProgressSpinnerModule,
  ],
  templateUrl: './workshop-detail.html',
  styleUrl: './workshop-detail.css',
})
export class WorkshopDetail {
  private readonly api = inject(WorkshopsApi);
  private readonly route = inject(ActivatedRoute);
  private readonly reload = new Subject<void>();
  protected readonly state = signal<DetailState>({ status: 'loading' });
  constructor() {
    combineLatest([
      this.route.paramMap.pipe(
        map((params) => params.get('id') ?? ''),
        distinctUntilChanged(),
      ),
      this.reload.pipe(startWith(undefined)),
    ])
      .pipe(
        // Route changes and retries cancel any preceding request.
        switchMap(([id]) =>
          this.api.getWorkshop(id).pipe(
            map((workshop): DetailState => ({ status: 'success', workshop })),
            catchError((error: unknown) =>
              of<DetailState>(
                error instanceof HttpErrorResponse && error.status === 404
                  ? { status: 'not-found' }
                  : {
                      status: 'error',
                      message:
                        error instanceof HttpErrorResponse && error.status === 503
                          ? 'Workshops are temporarily unavailable'
                          : 'Unable to load workshop. Please try again.',
                    },
              ),
            ),
            startWith<DetailState>({ status: 'loading' }),
          ),
        ),
        takeUntilDestroyed(),
      )
      .subscribe((state) => this.state.set(state));
  }
  protected retry(): void {
    this.reload.next();
  }
}
