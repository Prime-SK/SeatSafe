import { TestBed, ComponentFixture } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { WorkshopBookings, attendeePagination } from './workshop-bookings';
import { Authentication } from '../auth/authentication';
import { REQUIRES_AUTH } from '../auth/auth-interceptor';
import { AdminAccess } from './admin-access';
describe('Administrator booking history', () => {
  let fixture: ComponentFixture<WorkshopBookings>, http: HttpTestingController;
  const account = signal<{ id: string; role: string } | null>({ id: 'admin', role: 'ADMIN' }),
    status = signal('signed-in');
  let params: BehaviorSubject<ReturnType<typeof convertToParamMap>>,
    generation = 1;
  const access = { permissionLost: vi.fn() };
  const workshop = {
    id: 'legacy',
    title: 'Current workshop',
    capacity: 3,
    reservedSeats: 1,
    availableSeats: 2,
    registrationOpen: true,
    startsAt: '2030-01-01T08:30:00.000Z',
  };
  const booking = {
    id: 'internal-booking-id',
    workshopId: 'legacy',
    status: 'ACTIVE',
    createdAt: '2026-01-01T10:00:00Z',
    cancelledAt: null,
    user: { id: 'user', displayName: 'Synthetic attendee', email: 'attendee@example.test' },
  };
  beforeEach(() => {
    account.set({ id: 'admin', role: 'ADMIN' });
    status.set('signed-in');
    generation = 1;
    access.permissionLost.mockReset();
    params = new BehaviorSubject(convertToParamMap({ page: '1', limit: '25' }));
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: ActivatedRoute,
          useValue: {
            paramMap: new BehaviorSubject(convertToParamMap({ id: 'legacy' })),
            queryParamMap: params,
          },
        },
        {
          provide: Authentication,
          useValue: { account, status, currentGeneration: () => generation },
        },
        { provide: AdminAccess, useValue: access },
      ],
    });
    vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    fixture = TestBed.createComponent(WorkshopBookings);
    http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
  });
  afterEach(() => {
    fixture.destroy();
    http.verify();
  });
  function requests() {
    return {
      workshop: http.expectOne('/api/workshops/legacy'),
      bookings: http.expectOne('/api/admin/workshops/legacy/bookings?page=1&limit=25'),
    };
  }
  async function render() {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }
  it('reads only the authenticated page and renders current safe fields without write controls', async () => {
    const req = requests();
    expect(req.bookings.request.context.get(REQUIRES_AUTH)).toBe(true);
    expect(req.bookings.request.method).toBe('GET');
    req.workshop.flush(workshop);
    req.bookings.flush({ items: [booking], total: 1, page: 1, limit: 25 });
    await render();
    expect(fixture.nativeElement.textContent).toContain('Synthetic attendee');
    expect(fixture.nativeElement.textContent).toContain('attendee@example.test');
    expect(fixture.nativeElement.textContent).toContain('Current workshop');
    expect(fixture.nativeElement.querySelector('app-cancel-booking')).toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain('internal-booking-id');
  });
  it('shows loading and empty history distinctly', async () => {
    expect(fixture.nativeElement.textContent).toContain('Loading workshop bookings');
    const req = requests();
    req.workshop.flush(workshop);
    req.bookings.flush({ items: [], total: 0, page: 1, limit: 25 });
    await render();
    expect(fixture.nativeElement.textContent).toContain('No bookings yet');
  });
  it('cancels obsolete reads when pagination changes', async () => {
    const old = requests();
    params.next(convertToParamMap({ page: '2', limit: '10' }));
    await render();
    expect(old.bookings.cancelled).toBe(true);
    expect(old.workshop.cancelled).toBe(true);
    http.expectOne('/api/workshops/legacy').flush(workshop);
    http
      .expectOne('/api/admin/workshops/legacy/bookings?page=2&limit=10')
      .flush({ items: [], total: 1, page: 2, limit: 10 });
    await render();
    expect(fixture.nativeElement.textContent).toContain('No bookings on this page');
  });
  it('clears attendee details on logout and cancels pending reads', async () => {
    const req = requests();
    req.workshop.flush(workshop);
    req.bookings.flush({ items: [booking], total: 1, page: 1, limit: 25 });
    await render();
    status.set('signing-out');
    account.set(null);
    generation++;
    await render();
    expect(fixture.nativeElement.textContent).not.toContain('attendee@example.test');
  });
  it('handles missing workshops without exposing raw errors', async () => {
    const req = requests();
    req.workshop.flush({ message: 'PRIVATE' }, { status: 404, statusText: 'Not found' });
    expect(req.bookings.cancelled).toBe(true);
    await render();
    expect(fixture.nativeElement.textContent).toContain('could not be found');
    expect(fixture.nativeElement.textContent).not.toContain('PRIVATE');
  });
  it('handles permission loss without replaying', async () => {
    const req = requests();
    req.workshop.flush(workshop);
    req.bookings.flush({ message: 'PRIVATE' }, { status: 403, statusText: 'Forbidden' });
    await render();
    expect(access.permissionLost).toHaveBeenCalledOnce();
    expect(fixture.nativeElement.textContent).not.toContain('PRIVATE');
  });
  it('clears current attendee data after a same-account role change', async () => {
    const req = requests();
    req.workshop.flush(workshop);
    req.bookings.flush({ items: [booking], total: 1, page: 1, limit: 25 });
    await render();
    account.set({ id: 'admin', role: 'USER' });
    await render();
    expect(fixture.nativeElement.textContent).not.toContain('attendee@example.test');
  });
  it('allows manual retry after safe availability feedback', async () => {
    const req = requests();
    req.workshop.flush(workshop);
    req.bookings.flush({ message: 'PRIVATE' }, { status: 503, statusText: 'Unavailable' });
    await render();
    expect(fixture.nativeElement.textContent).toContain('Please try again');
    [...fixture.nativeElement.querySelectorAll('button')]
      .find((button: any) => button.textContent.includes('Retry'))
      .click();
    await render();
    const retry = requests();
    retry.workshop.flush(workshop);
    retry.bookings.flush({ items: [], total: 0, page: 1, limit: 25 });
    await render();
    expect(fixture.nativeElement.textContent).toContain('No bookings yet');
  });
  it('normalizes malformed pagination', () => {
    expect(attendeePagination('-1', '999')).toEqual({ page: 1, limit: 25 });
    expect(attendeePagination('2', '50')).toEqual({ page: 2, limit: 50 });
    expect(attendeePagination('1', '11')).toEqual({ page: 1, limit: 25 });
    const req = requests();
    req.workshop.flush(workshop);
    req.bookings.flush({ items: [], total: 0, page: 1, limit: 25 });
  });
});
