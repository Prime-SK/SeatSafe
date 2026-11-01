import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { MessageModule } from 'primeng/message';
import { SkeletonModule } from 'primeng/skeleton';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { WorkshopsApi } from '../workshops/workshops-api';
import { Workshop } from '../workshops/workshop';
import { WorkshopDatePipe } from '../workshops/workshop-date.pipe';
import { AdminWorkshopsApi } from './admin-workshops-api';
@Component({
  selector: 'app-management-list',
  imports: [
    RouterLink,
    ButtonModule,
    CardModule,
    MessageModule,
    SkeletonModule,
    TableModule,
    TagModule,
    WorkshopDatePipe,
  ],
  templateUrl: './management-list.html',
  styleUrl: './management-list.css',
})
export class ManagementList {
  protected readonly saves = inject(AdminWorkshopsApi);
  private readonly api = inject(WorkshopsApi);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly workshops = signal<Workshop[]>([]);
  protected readonly state = signal<'loading' | 'ready' | 'error'>('loading');
  constructor() {
    this.load();
  }
  protected load(): void {
    this.state.set('loading');
    this.api
      .getWorkshops()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (workshops) => {
          this.workshops.set(workshops);
          this.state.set('ready');
        },
        error: () => this.state.set('error'),
      });
  }
}
