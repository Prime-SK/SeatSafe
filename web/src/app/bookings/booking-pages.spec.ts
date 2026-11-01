import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { By, Title } from '@angular/platform-browser';
import { Subject, of, throwError } from 'rxjs';
import { ConfirmationService } from 'primeng/api';
import type { Confirmation } from 'primeng/api';
import { ConfirmDialog } from 'primeng/confirmdialog';
import { Authentication, SessionStatus } from '../auth/authentication';
import { routes } from '../app.routes';
import { sessionTestingProvider } from '../auth/session-testing.spec-helper';
import { BookingPanel } from './booking-panel';
import { CancelBooking } from './cancel-booking';
import { Bookings } from './bookings';
import { ReservationKeys, RESERVATION_ENVIRONMENT } from './reservation-keys';
import { bookingFixture, memoryStorage } from './booking-fixtures.spec-helper';
import { bookingPagination } from './my-bookings';
@Component({ template: '<h1>Sign in</h1>' })
class SignInStub {}
describe('Booking screens and safe interaction states', () => {
  let http: HttpTestingController, storage: Storage;
  let fixture: ComponentFixture<BookingPanel>;
  const status = signal<SessionStatus>('signed-in');
  const account = signal<{ id: string; displayName: string; email: string; role: 'USER' } | null>(
    null,
  );
  let generation = 0;
  const logout = new Subject<void>();
  const auth = {
    status,
    account,
    message: signal(''),
    restoreNeeded: signal(false),
    currentGeneration: () => generation,
    logoutStarted: logout.asObservable(),
    ensureSession: () =>
      status() === 'signed-in' ? of(undefined) : throwError(() => Error('Sign in required')),
  };
  beforeEach(() => {
    generation = 0;
    status.set('signed-in');
    account.set({ id: 'account', displayName: 'Learner', email: 'l@example.test', role: 'USER' });
    storage = memoryStorage();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          ...routes.filter((route) => route.path !== 'login'),
          { path: 'login', component: SignInStub },
        ]),
        provideHttpClient(),
        provideHttpClientTesting(),
        sessionTestingProvider,
        { provide: Authentication, useValue: auth },
        {
          provide: RESERVATION_ENVIRONMENT,
          useValue: { storage: () => storage, uuid: () => crypto.randomUUID() },
        },
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => {
    http.verify({ ignoreCancelled: true });
    vi.restoreAllMocks();
  });
  async function render() {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }
  async function panel(
    workshop = { ...bookingFixture.workshop, availableSeats: 1, reservedSeats: 0 },
  ) {
    fixture = TestBed.createComponent(BookingPanel);
    fixture.componentRef.setInput('workshop', workshop);
    await render();
  }
  const check = (active = false) =>
    http
      .expectOne('/api/bookings/me?page=1&limit=100')
      .flush({ items: active ? [bookingFixture] : [], total: active ? 1 : 0, page: 1, limit: 100 });
  const button = (label: string) =>
    [...fixture.nativeElement.querySelectorAll('button')].find(
      (node: unknown) => (node as HTMLElement).textContent?.trim() === label,
    ) as HTMLButtonElement | undefined;
  it('keeps public details available with a sign-in action and no protected lookup', async () => {
    account.set(null);
    status.set('anonymous');
    await panel();
    expect(fixture.nativeElement.textContent).toContain('Sign in to reserve');
    http.expectNone('/api/bookings/me?page=1&limit=100');
  });
  it('does not offer reserve before a successful current-booking check', async () => {
    await panel();
    expect(button('Reserve one seat')).toBeUndefined();
    check();
    await render();
    expect(button('Reserve one seat')).toBeTruthy();
  });
  it('gives an active booking priority over full, closed and past status', async () => {
    await panel({
      ...bookingFixture.workshop,
      registrationOpen: false,
      startsAt: '2000-01-01T00:00:00Z',
    });
    check(true);
    await render();
    expect(fixture.nativeElement.textContent).toContain('Your seat is reserved');
    expect(button('Cancel booking')).toBeTruthy();
    expect(button('Reserve one seat')).toBeUndefined();
  });
  it('fails safely on lookup failure and offers a read-only retry', async () => {
    await panel();
    http
      .expectOne('/api/bookings/me?page=1&limit=100')
      .flush({ message: 'private' }, { status: 503, statusText: 'Unavailable' });
    await render();
    expect(button('Reserve one seat')).toBeUndefined();
    expect(fixture.nativeElement.textContent).not.toContain('private');
    button('Retry booking check')!.click();
    await render();
    check();
    await render();
    expect(button('Reserve one seat')).toBeTruthy();
  });
  it('does not present an old replayed creation snapshot as a currently active seat', async () => {
    await panel();
    check();
    await render();
    button('Reserve one seat')!.click();
    await render();
    const post = http.expectOne('/api/workshops/legacy%2Fid/bookings');
    expect(button('Reserve one seat')).toBeUndefined();
    post.flush(bookingFixture);
    await render();
    check();
    await render();
    expect(fixture.nativeElement.textContent).toContain('no longer active');
    expect(fixture.nativeElement.textContent).not.toContain('Your seat is reserved');
  });
  it('distinguishes confirmed request from a failed status reload without repeating the write', async () => {
    await panel();
    check();
    await render();
    button('Reserve one seat')!.click();
    await render();
    http.expectOne('/api/workshops/legacy%2Fid/bookings').flush(bookingFixture);
    await render();
    http
      .expectOne('/api/bookings/me?page=1&limit=100')
      .flush({}, { status: 503, statusText: 'Unavailable' });
    await render();
    expect(fixture.nativeElement.textContent).toContain('request completed');
    expect(fixture.nativeElement.textContent).not.toContain('Your seat is reserved');
    button('Retry booking check')!.click();
    await render();
    check(true);
    await render();
    http.expectNone('/api/workshops/legacy%2Fid/bookings');
  });
  it('shows a saved request after reload and reuses it only after a deliberate retry', async () => {
    const key = TestBed.inject(ReservationKeys).obtain('account', 'legacy/id');
    await panel();
    check();
    await render();
    expect(button('Retry reservation')).toBeTruthy();
    http.expectNone('/api/workshops/legacy%2Fid/bookings');
    button('Retry reservation')!.click();
    await render();
    const post = http.expectOne('/api/workshops/legacy%2Fid/bookings');
    expect(post.request.headers.get('Idempotency-Key')).toBe(key);
    post.flush(bookingFixture);
    await render();
    check(true);
    await render();
  });
  it('requires explicit clearing of a corrupt record after a successful booking check', async () => {
    TestBed.inject(ReservationKeys).obtain('account', 'legacy/id');
    storage.setItem(storage.key(0)!, 'broken');
    await panel();
    expect(button('Clear saved request')).toBeUndefined();
    check();
    await render();
    expect(button('Reserve one seat')).toBeUndefined();
    button('Clear saved request')!.click();
    await render();
    check();
    await render();
    http.expectNone('/api/workshops/legacy%2Fid/bookings');
    expect(button('Reserve one seat')).toBeTruthy();
  });
  it('rechecks start time on click without submitting a now-ineligible reservation', async () => {
    await panel();
    check();
    await render();
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2041-01-01T00:00:00Z'));
    button('Reserve one seat')!.click();
    await render();
    check();
    await render();
    expect(fixture.nativeElement.textContent).toContain('already started');
    http.expectNone('/api/workshops/legacy%2Fid/bookings');
  });
  it('confirms cancellation with safe default focus and never confirms ordinary reserve', async () => {
    await panel();
    check(true);
    await render();
    const child = fixture.debugElement.query(By.directive(CancelBooking));
    const confirm = child.injector.get(ConfirmationService);
    let dialog: Confirmation | undefined;
    vi.spyOn(confirm, 'confirm').mockImplementation((value) => {
      dialog = value;
      return confirm;
    });
    button('Cancel booking')!.click();
    expect(dialog).toMatchObject({
      defaultFocus: 'reject',
      rejectButtonProps: { label: 'Keep booking' },
      acceptButtonProps: { label: 'Cancel booking', severity: 'danger' },
    });
    http.expectNone('/api/bookings/booking-one/cancel');
    dialog!.accept!();
    await render();
    http
      .expectOne('/api/bookings/booking-one/cancel')
      .flush({ ...bookingFixture, status: 'CANCELLED', cancelledAt: '2030-02-01T00:00:00Z' });
    await render();
    check();
    await render();
  });
  it('does not accept a stale confirmation after an identity change', async () => {
    await panel();
    check(true);
    await render();
    const child = fixture.debugElement.query(By.directive(CancelBooking));
    const confirm = child.injector.get(ConfirmationService);
    let dialog: Confirmation | undefined;
    vi.spyOn(confirm, 'confirm').mockImplementation((value) => {
      dialog = value;
      return confirm;
    });
    button('Cancel booking')!.click();
    generation++;
    account.set(null);
    status.set('signing-out');
    await render();
    dialog!.accept!();
    http.expectNone('/api/bookings/booking-one/cancel');
    expect(fixture.nativeElement.textContent).not.toContain('Your seat is reserved');
  });
  it('keeps dispatched writes alive after the view is destroyed', async () => {
    await panel();
    check();
    await render();
    button('Reserve one seat')!.click();
    await render();
    const post = http.expectOne('/api/workshops/legacy%2Fid/bookings');
    fixture.destroy();
    expect(post.cancelled).toBe(false);
    post.flush(bookingFixture);
    expect(TestBed.inject(Bookings).operation('legacy/id')?.kind).toBe('confirmed-reserve');
  });
  it('lets Escape reject the actual dialog without dispatching cancellation', async () => {
    await panel();
    check(true);
    await render();
    button('Cancel booking')!.click();
    await render();
    const dialog = fixture.debugElement.query(By.directive(ConfirmDialog))
      .componentInstance as ConfirmDialog;
    expect(dialog.visible()).toBe(true);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await render();
    expect(dialog.visible()).toBe(false);
    http.expectNone('/api/bookings/booking-one/cancel');
  });
  it('renders paginated history with current schedule, both statuses, links and the route title', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/bookings?page=2&limit=10');
    harness.detectChanges();
    http.expectOne('/api/bookings/me?page=2&limit=10').flush({
      items: [
        bookingFixture,
        {
          ...bookingFixture,
          id: 'old',
          status: 'CANCELLED',
          cancelledAt: '2030-02-01T00:00:00Z',
        },
      ],
      total: 12,
      page: 2,
      limit: 10,
    });
    harness.detectChanges();
    await harness.fixture.whenStable();
    harness.detectChanges();
    const text = harness.routeNativeElement!.textContent;
    expect(text).toContain('Seat reserved');
    expect(text).toContain('Cancelled');
    expect(text).toContain('Sri Lanka time');
    expect(text).toContain('12 bookings');
    expect(TestBed.inject(Title).getTitle()).toBe('My bookings | SeatSafe');
    expect(harness.routeNativeElement!.querySelectorAll('app-cancel-booking')).toHaveLength(1);
    expect(
      harness.routeNativeElement!.querySelector('a[href="/workshops/legacy%2Fid"]'),
    ).toBeTruthy();
  });
  it('canonicalizes invalid/unknown query parameters without sending client identity', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/bookings?page=0&limit=999&userId=other');
    harness.detectChanges();
    await harness.fixture.whenStable();
    expect(TestBed.inject(Router).url).toBe('/bookings?page=1&limit=25');
    http
      .expectOne('/api/bookings/me?page=1&limit=25')
      .flush({ items: [], total: 0, page: 1, limit: 25 });
    harness.detectChanges();
    await harness.fixture.whenStable();
    harness.detectChanges();
    expect(harness.routeNativeElement!.textContent).toContain('No bookings yet');
  });
  it('routes anonymous history access to sign-in without a booking request', async () => {
    account.set(null);
    status.set('anonymous');
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/bookings');
    harness.detectChanges();
    expect(TestBed.inject(Router).url).toBe('/login');
    http.expectNone((request) => request.url === '/api/bookings/me');
  });
  it.each([
    ['0', '25', 1, 25],
    ['2', '100', 2, 100],
    ['1.5', '10', 1, 10],
    ['2147483648', '50', 1, 50],
    [null, null, 1, 25],
    ['1', '7', 1, 25],
  ])('validates pagination %s/%s', (page, limit, expectedPage, expectedLimit) => {
    expect(bookingPagination(page as string | null, limit as string | null)).toEqual({
      page: expectedPage,
      limit: expectedLimit,
    });
  });
});
