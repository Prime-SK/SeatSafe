import { TestBed } from '@angular/core/testing';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Authentication } from '../auth/authentication';
import { authInterceptor, REQUIRES_AUTH } from '../auth/auth-interceptor';
import { sessionTestingProvider } from '../auth/session-testing.spec-helper';
import { LabClient } from './lab-client';
import { labFixture } from './lab-fixture.spec-helper';
describe('Lab requests and identity ownership', () => {
  it('clears protected results and blocks controls on later permission loss without refresh', () => {
    lab.start(labFixture.runId, 'matching-key');
    http
      .expectOne('/api/admin/reliability/runs')
      .flush({}, { status: 403, statusText: 'Forbidden' });
    expect(lab.denied()).toBe(true);
    expect(lab.report()).toBeNull();
    expect(lab.enabled()).toBe(false);
    http.expectNone('/api/auth/refresh');
  });
  let http: HttpTestingController, auth: Authentication, lab: LabClient;
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
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        sessionTestingProvider,
      ],
    });
    http = TestBed.inject(HttpTestingController);
    auth = TestBed.inject(Authentication);
    lab = TestBed.inject(LabClient);
    TestBed.tick();
    login();
    http
      .expectOne('/api/admin/reliability/capabilities')
      .flush({ enabled: true, scenarios: ['matching-key'] });
  });
  afterEach(() => {
    http.verify({ ignoreCancelled: true });
    vi.useRealTimers();
  });
  it('sends the exact authenticated start once', () => {
    lab.start(labFixture.runId, 'matching-key');
    lab.start(labFixture.runId, 'matching-key');
    const call = http.expectOne('/api/admin/reliability/runs');
    expect(call.request.body).toEqual({ runId: labFixture.runId, scenario: 'matching-key' });
    expect(call.request.context.get(REQUIRES_AUTH)).toBe(true);
    expect(call.request.headers.get('Authorization')).toBe('Bearer private-admin');
    call.flush(labFixture);
    expect(lab.report()?.cleanup).toBe('removed');
  });
  it.each([0, 500, 503])('never repeats uncertain start %i; recovery is a read', (status) => {
    lab.start(labFixture.runId, 'matching-key');
    const call = http.expectOne('/api/admin/reliability/runs');
    if (status === 0) call.error(new ProgressEvent('error'));
    else call.flush({ message: 'PRIVATE' }, { status, statusText: 'Unavailable' });
    expect(lab.uncertain()).toBe(true);
    expect(lab.message()).not.toContain('PRIVATE');
    lab.start('new', 'matching-key');
    http.expectNone('/api/admin/reliability/runs');
    lab.read(labFixture.runId).subscribe();
    http.expectOne('/api/admin/reliability/runs/' + labFixture.runId).flush(labFixture);
    expect(lab.uncertain()).toBe(false);
  });
  it('offers a deliberate new start for missing results', () => {
    lab.read(labFixture.runId).subscribe({ error: () => undefined });
    http
      .expectOne('/api/admin/reliability/runs/' + labFixture.runId)
      .flush({}, { status: 404, statusText: 'Not Found' });
    expect(lab.report()).toBeNull();
    expect(lab.message()).toContain('temporary');
  });
  it('suppresses late starts after logout', () => {
    lab.start(labFixture.runId, 'matching-key');
    const call = http.expectOne('/api/admin/reliability/runs');
    auth.logout().subscribe();
    http.expectOne('/api/auth/logout').flush(null, { status: 204, statusText: 'No Content' });
    call.flush(labFixture);
    TestBed.tick();
    expect(lab.report()).toBeNull();
    expect(lab.enabled()).toBe(false);
  });
  it('ignores capability responses for obsolete identities', () => {
    lab.checkAvailability();
    const old = http.expectOne('/api/admin/reliability/capabilities');
    login('new-admin');
    const current = http.expectOne('/api/admin/reliability/capabilities');
    old.flush({ enabled: false, scenarios: [] });
    current.flush({ enabled: true, scenarios: ['matching-key'] });
    expect(lab.enabled()).toBe(true);
  });
  it('refreshes before expired access but never replays POST', () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 901000);
    lab.start(labFixture.runId, 'matching-key');
    http.expectOne('/api/auth/refresh').flush({
      accessToken: 'replacement',
      tokenType: 'Bearer',
      expiresIn: 900,
      user: { id: 'admin', displayName: 'Admin', email: 'a@example.test', role: 'ADMIN' },
    });
    http
      .expectOne('/api/admin/reliability/runs')
      .flush({}, { status: 401, statusText: 'Unauthorized' });
    http.expectNone('/api/admin/reliability/runs');
  });
});
