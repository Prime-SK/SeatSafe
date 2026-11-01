import { Component, DestroyRef, effect, inject, input } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { Router } from '@angular/router';
import { ConfirmationService } from 'primeng/api';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { ButtonModule } from 'primeng/button';
import { Authentication } from '../auth/authentication';
import { Booking } from './booking';
import { Bookings } from './bookings';
import { installBookingTheme } from './booking-theme';
import { BookingFocus } from './booking-focus';
installBookingTheme();
@Component({
  selector: 'app-cancel-booking',
  imports: [ButtonModule, ConfirmDialogModule],
  providers: [ConfirmationService],
  template: `<button
      pButton
      type="button"
      severity="danger"
      variant="outlined"
      [disabled]="store.pending(booking().workshopId) || auth.status() !== 'signed-in'"
      (click)="ask($event)"
    >
      Cancel booking
    </button>
    <p-confirmdialog
      [style]="{ width: 'min(28rem, calc(100vw - 2rem))' }"
      [draggable]="false"
      [closable]="true"
      [closeOnEscape]="true"
      defaultFocus="reject"
      (onHide)="restoreFocus()"
    />`,
})
export class CancelBooking {
  readonly booking = input.required<Booking>();
  readonly title = input.required<string>();
  protected readonly auth = inject(Authentication);
  protected readonly store = inject(Bookings);
  private readonly confirm = inject(ConfirmationService);
  private readonly document = inject(DOCUMENT);
  private readonly router = inject(Router);
  private readonly focus = inject(BookingFocus);
  private openedAt = '';
  private trigger: HTMLElement | null = null;
  private generation = this.auth.currentGeneration();
  private destroyed = false;
  constructor() {
    effect(() => {
      const status = this.auth.status();
      this.auth.account();
      if (
        this.generation !== this.auth.currentGeneration() ||
        ['signing-out', 'logout-failed', 'anonymous', 'unavailable'].includes(status)
      ) {
        this.trigger = null;
        this.confirm.close();
        this.generation = this.auth.currentGeneration();
      }
    });
    inject(DestroyRef).onDestroy(() => {
      this.destroyed = true;
      this.confirm.close();
      this.restoreFocus();
    });
  }
  protected ask(event: Event): void {
    if (this.auth.status() !== 'signed-in' || this.store.pending(this.booking().workshopId)) return;
    const booking = this.booking(),
      generation = this.auth.currentGeneration();
    this.trigger = event.currentTarget as HTMLElement;
    this.openedAt = this.router.url;
    this.confirm.confirm({
      header: 'Cancel your booking?',
      message: `Release your seat for “${this.title()}”? Your booking will remain in your history.`,
      defaultFocus: 'reject',
      rejectButtonProps: { label: 'Keep booking', severity: 'secondary' },
      acceptButtonProps: { label: 'Cancel booking', severity: 'danger' },
      accept: () => {
        if (
          !this.destroyed &&
          generation === this.auth.currentGeneration() &&
          this.auth.status() === 'signed-in'
        ) {
          this.focus.afterCancellation(this.trigger, booking.workshopId);
          this.store.cancel(booking);
        }
      },
    });
  }
  protected restoreFocus(): void {
    const trigger = this.trigger;
    this.trigger = null;
    queueMicrotask(() => {
      if (
        this.router.url !== this.openedAt ||
        this.generation !== this.auth.currentGeneration() ||
        !['signed-in', 'checking'].includes(this.auth.status())
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
