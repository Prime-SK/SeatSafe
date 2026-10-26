import { sessionTestingProvider } from './session-testing.spec-helper';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Authentication } from './authentication';

describe('In-memory authentication', () => {
  let auth: Authentication;
  let http: HttpTestingController;
  const input = { email: 'learner@example.test', password: ' 🔐 unchanged password ' };
  const response = {
    accessToken: 'private-memory-fixture',
    tokenType: 'Bearer',
    expiresIn: 900,
    user: { id: 'user', displayName: 'Learner', email: input.email, role: 'USER' },
  };
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [sessionTestingProvider, provideHttpClient(), provideHttpClientTesting()],
    });
    auth = TestBed.inject(Authentication);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => {
    http.verify();
    TestBed.resetTestingModule();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });
  it('starts empty, posts only credentials and exposes only a safe account after success', () => {
    const persist = vi.spyOn(Storage.prototype, 'setItem');
    expect(auth.authenticated()).toBe(false);
    expect(auth.account()).toBeNull();
    auth.login(input).subscribe((value) => expect(value).toBeUndefined());
    const req = http.expectOne('/api/auth/login');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(input);
    expect(req.request.headers.keys()).toEqual([]);
    expect(req.request.withCredentials).toBe(false);
    req.flush(response);
    expect(auth.authenticated()).toBe(true);
    expect(auth.account()).toEqual(response.user);
    expect(auth.account()).not.toHaveProperty('accessToken');
    expect(persist).not.toHaveBeenCalled();
  });
  it('uses request start rather than response arrival for conservative local expiry', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2030-01-01T00:00:00Z'));
    auth.login(input).subscribe();
    const req = http.expectOne('/api/auth/login');
    vi.advanceTimersByTime(200);
    req.flush({ ...response, expiresIn: 1 });
    vi.advanceTimersByTime(799);
    expect(auth.authenticated()).toBe(true);
    vi.advanceTimersByTime(1);
    expect(auth.authenticated()).toBe(false);
    expect(auth.account()).toEqual(response.user);
    http.expectNone('/api/auth/refresh');
    http.expectNone('/api/auth/logout');
  });
  it('never establishes state from a failed request or automatically retries', () => {
    auth.login(input).subscribe({ error: () => undefined });
    http
      .expectOne('/api/auth/login')
      .flush({ message: 'private error' }, { status: 401, statusText: 'Unauthorized' });
    expect(auth.authenticated()).toBe(false);
    http.expectNone('/api/auth/login');
    http.expectNone('/api/auth/refresh');
  });
  it('rejects responses whose lifetime is already over without exposing their token', () => {
    vi.useFakeTimers();
    auth.login(input).subscribe({
      error: (error) => expect(error.message).toBe('Unable to establish authentication'),
    });
    const req = http.expectOne('/api/auth/login');
    vi.advanceTimersByTime(1000);
    req.flush({ ...response, expiresIn: 1 });
    expect(auth.authenticated()).toBe(false);
  });
  it('restores through a new request when a new application instance starts', () => {
    auth.login(input).subscribe();
    http.expectOne('/api/auth/login').flush(response);
    expect(auth.authenticated()).toBe(true);
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [sessionTestingProvider, provideHttpClient(), provideHttpClientTesting()],
    });
    auth = TestBed.inject(Authentication);
    http = TestBed.inject(HttpTestingController);
    expect(auth.account()).toBeNull();
    auth.initialize().subscribe();
    http.expectOne('/api/auth/refresh').flush(response);
    expect(auth.account()).toEqual(response.user);
  });
});
