import { TestBed } from '@angular/core/testing';
import {
  HttpClient,
  HttpContext,
  HttpErrorResponse,
  provideHttpClient,
  withInterceptors,
} from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { Authentication } from './authentication';
import { SessionCoordinator } from './session-coordinator';
import { TestSessionCoordinator, sessionTestingProvider } from './session-testing.spec-helper';
import { authInterceptor, REQUIRES_AUTH } from './auth-interceptor';
import { routes } from '../app.routes';

const input = { email: 'learner@example.test', password: ' unchanged Unicode 🔐 ' };
const result = {
  accessToken: 'token-one',
  tokenType: 'Bearer',
  expiresIn: 900,
  user: { id: 'user', displayName: 'Learner', email: input.email, role: 'USER' },
};
const context = () => new HttpContext().set(REQUIRES_AUTH, true);
describe('Coordinated browser sessions', () => {
  let auth: Authentication,
    http: HttpTestingController,
    client: HttpClient,
    coordinator: TestSessionCoordinator;
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        sessionTestingProvider,
        provideRouter(routes),
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    auth = TestBed.inject(Authentication);
    http = TestBed.inject(HttpTestingController);
    client = TestBed.inject(HttpClient);
    coordinator = TestBed.inject(SessionCoordinator) as unknown as TestSessionCoordinator;
  });
  afterEach(() => {
    http.verify();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });
  const login = () => {
    auth.login(input).subscribe();
    http.expectOne('/api/auth/login').flush(result);
  };
  const me = (error = (_: unknown) => undefined) =>
    client.get('/api/auth/me', { context: context() }).subscribe({ error });
  it('restores once and coalesces startup with concurrent protected requests', () => {
    auth.initialize().subscribe();
    auth.initialize().subscribe();
    me();
    me();
    expect(auth.status()).toBe('checking');
    const refresh = http.expectOne('/api/auth/refresh');
    expect(refresh.request.headers.has('Authorization')).toBe(false);
    expect(refresh.request.body).toEqual({});
    expect(refresh.request.withCredentials).toBe(false);
    refresh.flush(result);
    const requests = http.match('/api/auth/me');
    expect(requests.length).toBe(2);
    requests.forEach((req) => {
      expect(req.request.headers.get('Authorization')).toBe('Bearer token-one');
      req.flush(result.user);
    });
    expect(auth.account()).toEqual(result.user);
    expect(auth.status()).toBe('signed-in');
  });
  it('treats startup 401 as anonymous and does not retry automatically', () => {
    auth.initialize().subscribe();
    http.expectOne('/api/auth/refresh').flush({}, { status: 401, statusText: 'Unauthorized' });
    expect(auth.status()).toBe('anonymous');
    expect(auth.message()).toBe('');
    me();
    http.expectNone('/api/auth/me');
    http.expectNone('/api/auth/refresh');
  });
  it.each([0, 403, 429, 500, 503])(
    'keeps safe unavailable feedback after restoration failure %s',
    (status) => {
      auth.initialize().subscribe();
      const req = http.expectOne('/api/auth/refresh');
      if (status === 0) req.error(new ProgressEvent('error'));
      else req.flush({ message: 'private secret' }, { status, statusText: 'Error' });
      expect(auth.status()).toBe('unavailable');
      expect(auth.message()).not.toContain('private');
      expect(auth.message()).not.toBe('');
      me();
      http.expectNone('/api/auth/refresh');
      expect(auth.account()).toBeNull();
    },
  );
  it('does not refresh until a protected action needs an expired token', () => {
    vi.useFakeTimers();
    login();
    vi.advanceTimersByTime(900000);
    expect(auth.authenticated()).toBe(false);
    expect(auth.account()).toEqual(result.user);
    http.expectNone('/api/auth/refresh');
    me();
    http.expectOne('/api/auth/refresh').flush({ ...result, accessToken: 'token-two' });
    const request = http.expectOne('/api/auth/me');
    expect(request.request.headers.get('Authorization')).toBe('Bearer token-two');
    request.flush(result.user);
  });
  it('coalesces concurrent 401 recovery and uses the newer token for delayed 401 responses', () => {
    login();
    me();
    me();
    me();
    const requests = http.match('/api/auth/me');
    requests[0].flush({}, { status: 401, statusText: 'Unauthorized' });
    requests[1].flush({}, { status: 401, statusText: 'Unauthorized' });
    http.expectOne('/api/auth/refresh').flush({ ...result, accessToken: 'token-two' });
    requests[2].flush({}, { status: 401, statusText: 'Unauthorized' });
    const retries = http.match('/api/auth/me');
    expect(retries.length).toBe(3);
    retries.forEach((req) => {
      expect(req.request.headers.get('Authorization')).toBe('Bearer token-two');
      req.flush(result.user);
    });
    http.expectNone('/api/auth/refresh');
  });
  it('retries a protected GET only once and ends state after a second 401', () => {
    login();
    me();
    http.expectOne('/api/auth/me').flush({}, { status: 401, statusText: 'Unauthorized' });
    http.expectOne('/api/auth/refresh').flush({ ...result, accessToken: 'token-two' });
    http.expectOne('/api/auth/me').flush({}, { status: 401, statusText: 'Unauthorized' });
    expect(auth.account()).toBeNull();
    http.expectNone('/api/auth/refresh');
  });
  it.each([403, 503])('does not refresh on protected response %s', (status) => {
    login();
    me();
    http.expectOne('/api/auth/me').flush({}, { status, statusText: 'Error' });
    http.expectNone('/api/auth/refresh');
    expect(auth.account()).toEqual(result.user);
  });
  it('does not replay writes after 401', () => {
    login();
    client.post('/api/future', {}, { context: context() }).subscribe({ error: () => undefined });
    http.expectOne('/api/future').flush({}, { status: 401, statusText: 'Unauthorized' });
    http.expectNone('/api/auth/refresh');
    http.expectNone('/api/future');
  });
  it('does not attach credentials to public, external, absolute or auth lifecycle requests', () => {
    login();
    for (const url of [
      '/api/workshops',
      'https://example.test/api/auth/me',
      '//example.test/api/auth/me',
      'http://localhost/api/auth/me',
      '/api/auth/login',
      '/api/auth/refresh',
      '/api/auth/logout',
      '/api/auth/register',
    ]) {
      client
        .get(url, { context: url === '/api/workshops' ? new HttpContext() : context() })
        .subscribe();
      const req = http.expectOne(url);
      expect(req.request.headers.has('Authorization')).toBe(false);
      req.flush({});
    }
  });
  it('keeps a root-owned refresh alive after its subscriber leaves', () => {
    const sub = auth.initialize().subscribe();
    const req = http.expectOne('/api/auth/refresh');
    sub.unsubscribe();
    expect(req.cancelled).toBe(false);
    req.flush(result);
    expect(auth.authenticated()).toBe(true);
  });
  it('ignores late refresh after logout begins and blocks new protected work', () => {
    auth.initialize().subscribe();
    const refresh = http.expectOne('/api/auth/refresh');
    auth.logout().subscribe();
    const logout = http.expectOne('/api/auth/logout');
    refresh.flush(result);
    expect(auth.account()).toBeNull();
    me();
    http.expectNone('/api/auth/me');
    logout.flush(null, { status: 204, statusText: 'No Content' });
    expect(auth.status()).toBe('anonymous');
  });
  it('does not let an old protected 401 destroy a newer login', () => {
    login();
    me();
    const older = http.expectOne('/api/auth/me');
    auth.login(input).subscribe();
    http.expectOne('/api/auth/login').flush({ ...result, accessToken: 'new-login' });
    older.flush({}, { status: 401, statusText: 'Unauthorized' });
    expect(auth.authenticated()).toBe(true);
    http.expectNone('/api/auth/refresh');
  });
  it('coalesces logout, blocks protected actions after failure and supports deliberate retry', () => {
    login();
    auth.logout().subscribe({ error: () => undefined });
    auth.logout().subscribe({ error: () => undefined });
    expect(auth.status()).toBe('signing-out');
    http.expectOne('/api/auth/logout').flush({}, { status: 503, statusText: 'Unavailable' });
    expect(auth.status()).toBe('logout-failed');
    expect(auth.message()).toContain('may still be active');
    expect(auth.canLogin()).toBe(false);
    me();
    http.expectNone('/api/auth/me');
    auth.logout().subscribe();
    http.expectOne('/api/auth/logout').flush(null, { status: 204, statusText: 'No Content' });
    expect(auth.status()).toBe('anonymous');
    expect(coordinator.sent).toContain('logout-completed');
  });
  it('uses lifecycle-only messages and restores another tab identity only on demand', () => {
    login();
    coordinator.incoming.next('session-changed');
    expect(auth.account()).toBeNull();
    expect(auth.restoreNeeded()).toBe(true);
    http.expectNone('/api/auth/refresh');
    me();
    http.expectOne('/api/auth/refresh').flush(result);
    http.expectOne('/api/auth/me').flush(result.user);
    expect(
      coordinator.sent.every((notice) => typeof notice === 'string' && !notice.includes('token')),
    ).toBe(true);
    coordinator.incoming.next('logout-started');
    expect(auth.status()).toBe('signing-out');
    coordinator.incoming.next('session-unavailable');
    expect(auth.status()).toBe('logout-failed');
    coordinator.incoming.next('logout-completed');
    expect(auth.status()).toBe('anonymous');
  });
  it('disables authenticated operations when coordination is unsupported', () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        {
          provide: SessionCoordinator,
          useValue: { supported: false, notices: coordinator.notices, announce: () => undefined },
        },
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    auth = TestBed.inject(Authentication);
    http = TestBed.inject(HttpTestingController);
    auth.initialize().subscribe();
    expect(auth.status()).toBe('unavailable');
    expect(auth.canLogin()).toBe(false);
    http.expectNone('/api/auth/refresh');
  });
  it('never persists tokens or safe account state', () => {
    const persist = vi.spyOn(Storage.prototype, 'setItem');
    login();
    auth.logout().subscribe();
    http.expectOne('/api/auth/logout').flush(null, { status: 204, statusText: 'No Content' });
    expect(persist).not.toHaveBeenCalled();
  });
  it('rejects a malformed successful login response without retaining identity', () => {
    auth.login(input).subscribe({ error: () => undefined });
    http
      .expectOne('/api/auth/login')
      .flush({ ...result, user: { ...result.user, role: 'UNKNOWN' } });
    expect(auth.account()).toBeNull();
    expect(auth.status()).toBe('unavailable');
    expect(coordinator.sent).toContain('session-unavailable');
  });
  it('ignores a login response superseded by another tab logout', () => {
    auth.login(input).subscribe({ error: () => undefined });
    const login = http.expectOne('/api/auth/login');
    coordinator.incoming.next('logout-started');
    login.flush(result);
    expect(auth.account()).toBeNull();
    expect(auth.status()).toBe('signing-out');
  });
  it('keeps restoration outages distinct from invalid credentials during guarded navigation', async () => {
    const pending = RouterTestingHarness.create('/account');
    await new Promise((resolve) => setTimeout(resolve, 0));
    http
      .expectOne('/api/auth/refresh')
      .flush({ message: 'private database details' }, { status: 503, statusText: 'Unavailable' });
    const harness = await pending;
    harness.detectChanges();
    expect(TestBed.inject(Router).url).toBe('/login');
    expect(harness.routeNativeElement!.textContent).toContain('could not be restored');
    expect(harness.routeNativeElement!.textContent).not.toContain('Invalid email or password');
  });
  it('guards Account, renders the current safe profile and can retry a read outage', async () => {
    login();
    const harness = await RouterTestingHarness.create('/account');
    http.expectOne('/api/auth/me').flush({}, { status: 503, statusText: 'Unavailable' });
    harness.detectChanges();
    await harness.fixture.whenStable();
    harness.detectChanges();
    expect(harness.routeNativeElement!.textContent).toContain('temporarily unavailable');
    harness.routeNativeElement!.querySelector<HTMLButtonElement>('button')!.click();
    http
      .expectOne('/api/auth/me')
      .flush({ ...result.user, displayName: 'Current name', role: 'ADMIN', extra: 'hidden' });
    harness.detectChanges();
    await harness.fixture.whenStable();
    harness.detectChanges();
    expect(document.title).toBe('Your account | SeatSafe');
    expect(harness.routeNativeElement!.textContent).toContain('Current name');
    expect(harness.routeNativeElement!.textContent).toContain('Administrator');
    expect(auth.account()).not.toHaveProperty('extra');
    auth.logout().subscribe();
    http.expectOne('/api/auth/logout').flush(null, { status: 204, statusText: 'No Content' });
    harness.detectChanges();
    expect(harness.routeNativeElement!.textContent).not.toContain('Current name');
  });
  it('redirects anonymous protected navigation to sign in after restoration', async () => {
    const pending = RouterTestingHarness.create('/account');
    await new Promise((resolve) => setTimeout(resolve, 0));
    http.expectOne('/api/auth/refresh').flush({}, { status: 401, statusText: 'Unauthorized' });
    await pending;
    expect(TestBed.inject(Router).url).toBe('/login');
  });
});
