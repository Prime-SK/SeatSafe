import {
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { MessageModule } from 'primeng/message';
import { Authentication } from '../auth/authentication';
import { Workshop } from '../workshops/workshop';
import { BookingItem } from './booking';
import { Bookings, bookingReadError } from './bookings';
import { ReservationKeyError } from './reservation-keys';
import { CancelBooking } from './cancel-booking';
type Status =
  | { kind: 'checking' }
  | { kind: 'ready'; active: BookingItem | null }
  | { kind: 'error'; message: string };
@Component({
  selector: 'app-booking-panel',
  imports: [RouterLink, ButtonModule, CardModule, MessageModule, CancelBooking],
  templateUrl: './booking-panel.html',
  styleUrl: './booking-panel.css',
})
export class BookingPanel {
  readonly workshop = input.required<Workshop>();
  protected readonly auth = inject(Authentication);
  protected readonly store = inject(Bookings);
  protected readonly state = signal<Status>({ kind: 'checking' });
  protected readonly keyError = signal('');
  protected readonly resettable = signal(false);
  protected readonly savedKey = signal(false);
  private readonly retryCount = signal(0);
  private readonly clock = signal(Date.now());
  private destroyed = false;
  protected readonly reason = computed(() => {
    this.clock();
    const row = this.workshop();
    return !row.registrationOpen
      ? 'Registration is closed for this workshop.'
      : Date.parse(row.startsAt) <= Date.now()
        ? 'This workshop has already started.'
        : row.availableSeats <= 0
          ? 'This workshop is full.'
          : '';
  });
  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.destroyed = true;
    });
    effect((cleanup) => {
      const id = this.workshop().id;
      this.auth.account();
      const status = this.auth.status();
      this.store.revision();
      this.retryCount();
      const pending = this.store.pending(id);
      this.state.set({ kind: 'checking' });
      this.keyError.set('');
      this.resettable.set(false);
      if (status !== 'signed-in' || !this.auth.account() || pending) return;
      untracked(() => this.readKey(id));
      const subscription = untracked(() => this.store.findActive(id)).subscribe({
        next: (active) => this.state.set({ kind: 'ready', active }),
        error: (error) => this.state.set({ kind: 'error', message: bookingReadError(error) }),
      });
      cleanup(() => subscription.unsubscribe());
    });
  }
  private readKey(id: string): void {
    try {
      this.savedKey.set(!!this.store.pendingKey(id));
    } catch (error) {
      this.savedKey.set(false);
      this.resettable.set(error instanceof ReservationKeyError && error.resettable);
      this.keyError.set(
        error instanceof ReservationKeyError && error.resettable
          ? 'This saved reservation needs review. Check your current booking before clearing it.'
          : 'Reservations are unavailable in this browser session. Allow site storage and use a current browser, then retry.',
      );
    }
  }
  protected retry(): void {
    this.retryCount.update((value) => value + 1);
  }
  protected reserve(): void {
    if (
      this.destroyed ||
      this.auth.status() !== 'signed-in' ||
      this.state().kind !== 'ready' ||
      this.keyError()
    )
      return;
    const row = this.workshop();
    // A deliberate recovery may replay an earlier result after workshop conditions changed.
    this.clock.set(Date.now());
    if (
      !this.savedKey() &&
      (!row.registrationOpen || Date.parse(row.startsAt) <= Date.now() || row.availableSeats <= 0)
    ) {
      this.retry();
      return;
    }
    this.store.reserve(row.id);
  }
  protected retryCancel(id: string): void {
    this.store.cancel({ id, workshopId: this.workshop().id });
  }
  protected reset(): void {
    if (this.state().kind === 'ready' && this.store.resetKey(this.workshop().id)) this.retry();
  }
}
