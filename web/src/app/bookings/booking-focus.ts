import { Injectable, afterEveryRender, inject } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { Router } from '@angular/router';
import { Authentication } from '../auth/authentication';
import { Bookings } from './bookings';

/** A dispatched cancellation can outlive its button; restore focus after replacement views render. */
@Injectable({ providedIn: 'root' })
export class BookingFocus {
  private readonly document = inject(DOCUMENT);
  private readonly router = inject(Router);
  private readonly auth = inject(Authentication);
  private readonly store = inject(Bookings);
  private intent: {
    url: string;
    generation: number;
    workshopId: string;
    trigger: HTMLElement | null;
  } | null = null;
  constructor() {
    afterEveryRender(() => {
      const intent = this.intent;
      if (!intent) return;
      if (this.router.url !== intent.url || this.auth.currentGeneration() !== intent.generation) {
        this.intent = null;
        return;
      }
      if (this.store.pending(intent.workshopId) || this.auth.status() !== 'signed-in') return;
      const main = this.document.querySelector('main');
      // Workshop reload replaces its heading; wait for the stable detail view rather than its skeleton.
      if (intent.url.startsWith('/workshops/') && !main?.querySelector('app-booking-panel')) return;
      const heading = main?.querySelector<HTMLElement>('h1');
      if (!heading) return;
      const active = this.document.activeElement;
      if (
        active === this.document.body ||
        active === intent.trigger ||
        active?.closest('p-confirmdialog')
      ) {
        heading.setAttribute('tabindex', '-1');
        heading.focus({ preventScroll: true });
      }
      this.intent = null;
    });
  }
  afterCancellation(trigger: HTMLElement | null, workshopId: string): void {
    this.intent = {
      trigger,
      workshopId,
      url: this.router.url,
      generation: this.auth.currentGeneration(),
    };
  }
}
