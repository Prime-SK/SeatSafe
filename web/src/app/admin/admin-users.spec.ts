import { TestBed } from '@angular/core/testing';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Authentication } from '../auth/authentication';
import { authInterceptor, REQUIRES_AUTH } from '../auth/auth-interceptor';
import { sessionTestingProvider } from '../auth/session-testing.spec-helper';
import { AdminUsers, AdminUser } from './admin-users';
import { AdminAccess } from './admin-access';
import { provideRouter } from '@angular/router';
describe('Administrator user requests and ownership', () => {
  let http: HttpTestingController, auth: Authentication, store: AdminUsers;
  const target: AdminUser = {
    id: 'target',
    displayName: 'Learner',
    email: 'l@example.test',
    role: 'USER',
    isEnabled: true,
  };
  const access = { permissionLost: vi.fn() };
  function login(id = 'admin') {
    auth.login({ email: 'admin@example.test', password: 'unchanged' }).subscribe();
    http.expectOne('/api/auth/login').flush({
      accessToken: 'private-' + id,
      tokenType: 'Bearer',
      expiresIn: 900,
      user: { id, displayName: 'Admin', email: 'admin@example.test', role: 'ADMIN' },
    });
    TestBed.tick();
  }
  beforeEach(() => {
    access.permissionLost.mockClear();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        sessionTestingProvider,
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        { provide: AdminAccess, useValue: access },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    auth = TestBed.inject(Authentication);
    store = TestBed.inject(AdminUsers);
    TestBed.tick();
    login();
  });
  afterEach(() => {
    http.verify({ ignoreCancelled: true });
    vi.useRealTimers();
  });
  const patch = () => http.expectOne('/api/admin/users/target/status');
  it('sends only exact authenticated query and status fields without a request key', () => {
    store.list({ page: 2, limit: 10, search: '雪 %_', status: 'disabled' }).subscribe();
    const read = http.expectOne((r) => r.url === '/api/admin/users');
    expect(read.request.params.keys().sort()).toEqual(['limit', 'page', 'search', 'status']);
    expect(read.request.params.get('search')).toBe('雪 %_');
    expect(read.request.context.get(REQUIRES_AUTH)).toBe(true);
    expect(read.request.headers.get('Authorization')).toBe('Bearer private-admin');
    read.flush({ items: [], total: 0, page: 2, limit: 10 });
    store.change(target, false);
    const call = patch();
    expect(call.request.method).toBe('PATCH');
    expect(call.request.body).toEqual({ isEnabled: false });
    expect(call.request.headers.has('Idempotency-Key')).toBe(false);
    expect(call.request.withCredentials).toBe(false);
    call.flush({ ...target, isEnabled: false });
    expect(store.notice()?.kind).toBe('confirmed');
  });
  it('allows one write at a time and never mutates the supplied account optimistically', () => {
    store.change(target, false);
    store.change({ ...target, id: 'other' }, false);
    expect(target.isEnabled).toBe(true);
    const call = patch();
    http.expectNone('/api/admin/users/other/status');
    expect(store.pending()).toBe(true);
    call.flush({ ...target, isEnabled: false });
    expect(store.pending()).toBe(false);
    expect(target.isEnabled).toBe(true);
  });
  it.each([0, 500, 503])(
    'blocks writes until deliberate inspection after uncertain %i',
    (status) => {
      store.change(target, false);
      const call = patch();
      if (status === 0) call.error(new ProgressEvent('error'));
      else call.flush({ message: 'PRIVATE' }, { status, statusText: 'Unavailable' });
      expect(store.notice()?.kind).toBe('uncertain');
      expect(store.notice()?.message).not.toContain('PRIVATE');
      store.change(target, false);
      http.expectNone('/api/admin/users/target/status');
      store.list({ page: 1, limit: 25 }).subscribe();
      http
        .expectOne('/api/admin/users?page=1&limit=25')
        .flush({ items: [target], total: 1, page: 1, limit: 25 });
      expect(store.canAct()).toBe(true);
      store.change(target, false);
      patch().flush({ ...target, isEnabled: false });
    },
  );
  it.each([
    [400, 'VALIDATION_FAILED'],
    [404, 'USER_NOT_FOUND'],
    [409, 'ADMIN_ACCOUNT_PROTECTED'],
  ])('handles business status %s without replay or raw messages', (status, code) => {
    store.change(target, false);
    patch().flush(
      { code, message: 'PRIVATE' },
      { status: status as number, statusText: 'Conflict' },
    );
    expect(store.notice()?.kind).toBe('error');
    expect(store.notice()?.message).not.toContain('PRIVATE');
    http.expectNone('/api/admin/users/target/status');
  });
  it('handles permission loss without refresh or replay', () => {
    store.change(target, false);
    patch().flush({}, { status: 403, statusText: 'Forbidden' });
    expect(access.permissionLost).toHaveBeenCalledOnce();
    expect(store.notice()).toBeNull();
    expect(store.canAct()).toBe(false);
    http.expectNone('/api/auth/refresh');
  });
  it('handles forbidden reads as permission loss', () => {
    store.list({ page: 1, limit: 25 }).subscribe({ error: () => undefined });
    http
      .expectOne('/api/admin/users?page=1&limit=25')
      .flush({}, { status: 403, statusText: 'Forbidden' });
    expect(access.permissionLost).toHaveBeenCalledOnce();
  });
  it('rejects reads started before a mutation', () => {
    let accepted = false;
    store
      .list({ page: 1, limit: 25 })
      .subscribe({ next: () => (accepted = true), error: () => undefined });
    const read = http.expectOne('/api/admin/users?page=1&limit=25');
    store.change(target, false);
    read.flush({ items: [target], total: 1, page: 1, limit: 25 });
    expect(accepted).toBe(false);
    patch().flush({ ...target, isEnabled: false });
  });
  it('suppresses late writes after logout and does not restore identity', () => {
    store.change(target, false);
    const call = patch();
    auth.logout().subscribe();
    http.expectOne('/api/auth/logout').flush(null, { status: 204, statusText: 'No Content' });
    call.flush({ ...target, isEnabled: false });
    TestBed.tick();
    expect(store.notice()).toBeNull();
    expect(auth.account()).toBeNull();
  });
  it('suppresses late writes after switching accounts', () => {
    store.change(target, false);
    const call = patch();
    login('new-admin');
    call.flush({ ...target, isEnabled: false });
    TestBed.tick();
    expect(store.notice()).toBeNull();
    expect(auth.account()?.id).toBe('new-admin');
  });
  it('refreshes expired access before PATCH and never replays a rejected write', () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 901000);
    store.change(target, false);
    http.expectOne('/api/auth/refresh').flush({
      accessToken: 'new-private',
      tokenType: 'Bearer',
      expiresIn: 900,
      user: { id: 'admin', displayName: 'Admin', email: 'admin@example.test', role: 'ADMIN' },
    });
    const call = patch();
    expect(call.request.headers.get('Authorization')).toBe('Bearer new-private');
    call.flush({}, { status: 401, statusText: 'Unauthorized' });
    http.expectNone('/api/admin/users/target/status');
  });
  it('supports one-time GET recovery through the existing interceptor', () => {
    store.list({ page: 1, limit: 25 }).subscribe();
    http
      .expectOne('/api/admin/users?page=1&limit=25')
      .flush({}, { status: 401, statusText: 'Unauthorized' });
    http.expectOne('/api/auth/refresh').flush({
      accessToken: 'replacement',
      tokenType: 'Bearer',
      expiresIn: 900,
      user: { id: 'admin', displayName: 'Admin', email: 'admin@example.test', role: 'ADMIN' },
    });
    const retry = http.expectOne('/api/admin/users?page=1&limit=25');
    expect(retry.request.headers.get('Authorization')).toBe('Bearer replacement');
    retry.flush({ items: [], total: 0, page: 1, limit: 25 });
  });
  it('does not dispatch actions for protected administrators', () => {
    store.change({ ...target, role: 'ADMIN' }, false);
    http.expectNone('/api/admin/users/target/status');
  });
});
