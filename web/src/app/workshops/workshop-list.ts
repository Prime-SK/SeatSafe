import { Component, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { Subject, catchError, map, of, startWith, switchMap } from 'rxjs';
import { Workshop } from './workshop';
import { WorkshopsApi } from './workshops-api';
import { WorkshopDatePipe } from './workshop-date.pipe';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { TagModule } from 'primeng/tag';
import { MessageModule } from 'primeng/message';
import { SkeletonModule } from 'primeng/skeleton';

type ListState =
  | { status: 'loading' }
  | { status: 'success'; workshops: Workshop[] }
  | { status: 'empty' }
  | { status: 'error'; message: string };

@Component({
  selector: 'app-workshop-list',
  imports: [
    RouterLink,
    WorkshopDatePipe,
    ButtonModule,
    CardModule,
    TagModule,
    MessageModule,
    SkeletonModule,
  ],
  templateUrl: './workshop-list.html',
  styleUrl: './workshop-list.css',
})
export class WorkshopList {
  private readonly api = inject(WorkshopsApi);
  private readonly reload = new Subject<void>();
  protected readonly state = signal<ListState>({ status: 'loading' });
  constructor() {
    this.reload
      .pipe(
        startWith(undefined),
        switchMap(() =>
          this.api.getWorkshops().pipe(
            map((workshops): ListState =>
              workshops.length ? { status: 'success', workshops } : { status: 'empty' },
            ),
            // Keep the outer reload stream alive after a failed request.
            catchError((error: unknown) =>
              of<ListState>({
                status: 'error',
                message:
                  error instanceof HttpErrorResponse && error.status === 503
                    ? 'Workshops are temporarily unavailable'
                    : 'Unable to load workshops. Please try again.',
              }),
            ),
            startWith<ListState>({ status: 'loading' }),
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
