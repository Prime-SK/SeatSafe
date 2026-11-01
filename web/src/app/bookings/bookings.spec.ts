import { TestBed } from '@angular/core/testing';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Authentication } from '../auth/authentication';
import { authInterceptor, REQUIRES_AUTH } from '../auth/auth-interceptor';
import { SessionCoordinator } from '../auth/session-coordinator';
import {
  TestSessionCoordinator,
  sessionTestingProvider,
} from '../auth/session-testing.spec-helper';
import { Bookings } from './bookings';
import { RESERVATION_ENVIRONMENT, ReservationKeys } from './reservation-keys';
import { memoryStorage, bookingFixture } from './booking-fixtures.spec-helper';
describe('Booking request ownership and recovery', () => {
  let http: HttpTestingController,
    auth: Authentication,
    store: Bookings,
    storage: Storage,
    keys: ReservationKeys;
  const login = (id = 'account') => {
    auth.login({ email: 'learner@example.test', password: 'unchanged' }).subscribe();
    http.expectOne('/api/auth/login').flush({
      accessToken: `private-${id}`,
      tokenType: 'Bearer',
      expiresIn: 900,
      user: { id, displayName: 'Learner', email: 'learner@example.test', role: 'USER' },
    });
    TestBed.tick();
  };
  beforeEach(() => {
    storage = memoryStorage();
    TestBed.configureTestingModule({
      providers: [
        sessionTestingProvider,
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        {
          provide: RESERVATION_ENVIRONMENT,
          useValue: { storage: () => storage, uuid: () => crypto.randomUUID() },
        },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    auth = TestBed.inject(Authentication);
    store = TestBed.inject(Bookings);
    keys = TestBed.inject(ReservationKeys);
    TestBed.tick();
    login();
  });
  afterEach(() => {
    http.verify({ ignoreCancelled: true });
    vi.useRealTimers();
  });
  const mutation = () => http.expectOne('/api/workshops/legacy%2Fid/bookings');
  it('persists the key before the exact authenticated request and prevents duplicate/conflicting writes', () => {
    store.reserve('legacy/id');
    store.reserve('legacy/id');
    store.cancel(bookingFixture);
    const call = mutation();
    expect(call.request.body).toEqual({});
    expect(call.request.context.get(REQUIRES_AUTH)).toBe(true);
    expect(call.request.headers.get('Authorization')).toBe('Bearer private-account');
    expect(call.request.headers.get('Idempotency-Key')).toBe(keys.peek('account', 'legacy/id'));
    expect(call.request.withCredentials).toBe(false);
    call.flush(bookingFixture);
    expect(store.pending('legacy/id')).toBe(false);
    expect(keys.peek('account', 'legacy/id')).toBeNull();
    expect(store.operation('legacy/id')?.kind).toBe('confirmed-reserve');
  });
  it.each([0, 500, 503])(
    'retains and deliberately reuses the request key after uncertain status %i',
    (status) => {
      store.reserve('legacy/id');
      const first = mutation();
      const key = first.request.headers.get('Idempotency-Key');
      first.flush({ message: 'private server detail' }, { status, statusText: 'Uncertain' });
      expect(store.operation('legacy/id')?.kind).toBe('uncertain-reserve');
      expect(store.operation('legacy/id')?.message).not.toContain('private server');
      http.expectNone('/api/workshops/legacy%2Fid/bookings');
      store.reserve('legacy/id');
      const retry = mutation();
      expect(retry.request.headers.get('Idempotency-Key')).toBe(key);
      retry.flush(bookingFixture);
    },
  );
  it.each([
    'ALREADY_BOOKED',
    'REGISTRATION_CLOSED',
    'WORKSHOP_ALREADY_STARTED',
    'WORKSHOP_FULL',
    'WORKSHOP_NOT_FOUND',
  ])('removes a definitive %s attempt and requires a new deliberate attempt', (code) => {
    store.reserve('legacy/id');
    const first = mutation();
    const key = first.request.headers.get('Idempotency-Key');
    first.flush(
      { code, message: 'untrusted' },
      { status: code === 'WORKSHOP_NOT_FOUND' ? 404 : 409, statusText: 'Conflict' },
    );
    expect(keys.peek('account', 'legacy/id')).toBeNull();
    expect(store.operation('legacy/id')?.message).not.toContain('untrusted');
    store.reserve('legacy/id');
    const next = mutation();
    expect(next.request.headers.get('Idempotency-Key')).not.toBe(key);
    next.flush(bookingFixture);
  });
  it('keeps a conflicting record until explicit recovery and does not submit a replacement', () => {
    store.reserve('legacy/id');
    mutation().flush({ code: 'IDEMPOTENCY_KEY_CONFLICT' }, { status: 409, statusText: 'Conflict' });
    expect(store.operation('legacy/id')?.kind).toBe('blocked');
    expect(keys.peek('account', 'legacy/id')).toBeTruthy();
    expect(store.resetKey('legacy/id')).toBe(true);
    expect(keys.peek('account', 'legacy/id')).toBeNull();
    http.expectNone('/api/workshops/legacy%2Fid/bookings');
  });
  it('blocks dispatch for corrupt storage, unavailable storage or failed secure key generation', () => {
    keys.obtain('account', 'legacy/id');
    storage.setItem(storage.key(0)!, 'broken');
    store.reserve('legacy/id');
    http.expectNone('/api/workshops/legacy%2Fid/bookings');
    expect(store.operation('legacy/id')?.kind).toBe('blocked');
    keys.remove('account', 'legacy/id');
    storage.setItem = () => {
      throw Error();
    };
    store.reserve('legacy/id');
    http.expectNone('/api/workshops/legacy%2Fid/bookings');
    expect(store.operation('legacy/id')?.message).toContain('site storage');
  });
  it('coalesces active lookup, scans later pages and preserves server ordering', () => {
    const found: unknown[] = [];
    store.findActive('legacy/id').subscribe((value) => found.push(value));
    store.findActive('legacy/id').subscribe((value) => found.push(value));
    const first = http.expectOne('/api/bookings/me?page=1&limit=100');
    expect(first.request.headers.get('Authorization')).toBe('Bearer private-account');
    first.flush({
      items: Array.from({ length: 100 }, () => ({ ...bookingFixture, workshopId: 'other' })),
      total: 101,
      page: 1,
      limit: 100,
    });
    http
      .expectOne('/api/bookings/me?page=2&limit=100')
      .flush({ items: [bookingFixture], total: 101, page: 2, limit: 100 });
    expect(found).toEqual([bookingFixture, bookingFixture]);
  });
  it('never treats a failed later history page as absence', () => {
    let next = false,
      failed = false;
    store.findActive('legacy/id').subscribe({
      next: () => {
        next = true;
      },
      error: () => {
        failed = true;
      },
    });
    http.expectOne('/api/bookings/me?page=1&limit=100').flush({
      items: [{ ...bookingFixture, workshopId: 'other' }],
      total: 101,
      page: 1,
      limit: 100,
    });
    http
      .expectOne('/api/bookings/me?page=2&limit=100')
      .flush({}, { status: 503, statusText: 'Unavailable' });
    expect(next).toBe(false);
    expect(failed).toBe(true);
  });
  it('invalidates old reads when a mutation starts and does not cache lookup absence', () => {
    let failed = false;
    store.findActive('legacy/id').subscribe({
      error: () => {
        failed = true;
      },
    });
    const old = http.expectOne('/api/bookings/me?page=1&limit=100');
    store.reserve('legacy/id');
    old.flush({ items: [], total: 0, page: 1, limit: 100 });
    expect(failed).toBe(true);
    mutation().flush(bookingFixture);
    store.findActive('legacy/id').subscribe();
    http
      .expectOne('/api/bookings/me?page=1&limit=100')
      .flush({ items: [bookingFixture], total: 1, page: 1, limit: 100 });
  });
  it('cancels without a key, owns the write through completion and retries only deliberately', () => {
    store.cancel(bookingFixture);
    const call = http.expectOne('/api/bookings/booking-one/cancel');
    expect(call.request.headers.has('Idempotency-Key')).toBe(false);
    expect(call.request.body).toEqual({});
    call.flush({}, { status: 503, statusText: 'Unavailable' });
    expect(store.operation('legacy/id')).toMatchObject({
      kind: 'uncertain-cancel',
      bookingId: 'booking-one',
    });
    store.cancel(bookingFixture);
    http
      .expectOne('/api/bookings/booking-one/cancel')
      .flush({ ...bookingFixture, status: 'CANCELLED', cancelledAt: '2030-02-01T00:00:00Z' });
    expect(store.operation('legacy/id')?.kind).toBe('confirmed-cancel');
    expect(storage.length).toBe(0);
  });
  it('keeps a dispatched request alive on consumer navigation and ignores late results after logout', () => {
    store.reserve('legacy/id');
    const call = mutation();
    auth.logout().subscribe();
    expect(storage.length).toBe(0);
    call.flush(bookingFixture);
    http.expectOne('/api/auth/logout').flush(null, { status: 204, statusText: 'No Content' });
    TestBed.tick();
    expect(store.operation('legacy/id')).toBeUndefined();
    expect(auth.account()).toBeNull();
  });
  it('ignores an old account response and purges its records before using a verified new identity', () => {
    store.reserve('legacy/id');
    const old = mutation();
    login('new-account');
    expect(storage.length).toBe(0);
    old.flush(bookingFixture);
    expect(store.operation('legacy/id')).toBeUndefined();
    store.reserve('legacy/id');
    const current = mutation();
    expect(current.request.headers.get('Authorization')).toBe('Bearer private-new-account');
    current.flush(bookingFixture);
  });
  it('retains keys through transient authentication failure and cross-tab session change', () => {
    store.reserve('legacy/id');
    mutation().flush({}, { status: 503, statusText: 'Unavailable' });
    const key = keys.peek('account', 'legacy/id');
    const coordinator = TestBed.inject(SessionCoordinator) as unknown as TestSessionCoordinator;
    coordinator.incoming.next('session-changed');
    TestBed.tick();
    expect(keys.peek('account', 'legacy/id')).toBe(key);
    coordinator.incoming.next('logout-started');
    expect(storage.length).toBe(0);
  });
  it('refreshes before an expired-token write without losing its key or replaying write 401', () => {
    vi.useFakeTimers();
    keys.obtain('account', 'legacy/id');
    const key = keys.peek('account', 'legacy/id');
    vi.advanceTimersByTime(901000);
    store.reserve('legacy/id');
    http.expectNone('/api/workshops/legacy%2Fid/bookings');
    http.expectOne('/api/auth/refresh').flush({
      accessToken: 'fresh',
      tokenType: 'Bearer',
      expiresIn: 900,
      user: {
        id: 'account',
        displayName: 'Learner',
        email: 'learner@example.test',
        role: 'USER',
      },
    });
    const call = mutation();
    expect(call.request.headers.get('Authorization')).toBe('Bearer fresh');
    expect(call.request.headers.get('Idempotency-Key')).toBe(key);
    call.flush({}, { status: 401, statusText: 'Unauthorized' });
    http.expectNone('/api/auth/refresh');
    http.expectNone('/api/workshops/legacy%2Fid/bookings');
    expect(keys.peek('account', 'legacy/id')).toBe(key);
  });
  it('recovers an authenticated history GET once with a fresh token', () => {
    let total = -1;
    store.list().subscribe((page) => {
      total = page.total;
    });
    http
      .expectOne('/api/bookings/me?page=1&limit=25')
      .flush({}, { status: 401, statusText: 'Unauthorized' });
    http.expectOne('/api/auth/refresh').flush({
      accessToken: 'fresh-read-token',
      tokenType: 'Bearer',
      expiresIn: 900,
      user: {
        id: 'account',
        displayName: 'Learner',
        email: 'learner@example.test',
        role: 'USER',
      },
    });
    const retry = http.expectOne('/api/bookings/me?page=1&limit=25');
    expect(retry.request.headers.get('Authorization')).toBe('Bearer fresh-read-token');
    retry.flush({ items: [], total: 0, page: 1, limit: 25 });
    expect(total).toBe(0);
    http.expectNone('/api/auth/refresh');
  });
  it('does not let an obsolete account write block the new account history', () => {
    store.reserve('legacy/id');
    const old = mutation();
    login('new-account');
    expect(store.anyPending()).toBe(false);
    store.list().subscribe();
    http
      .expectOne('/api/bookings/me?page=1&limit=25')
      .flush({ items: [], total: 0, page: 1, limit: 25 });
    old.flush(bookingFixture);
    expect(store.notice()).toBeNull();
  });
});
