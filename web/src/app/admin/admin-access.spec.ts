import { TestBed } from '@angular/core/testing';
import { HttpClient, HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter, Router } from '@angular/router';
import { of, throwError } from 'rxjs';
import { Authentication } from '../auth/authentication';
import { REQUIRES_AUTH } from '../auth/auth-interceptor';
import { AdminAccess } from './admin-access';
describe('Administrator access', () => {
  let http: HttpTestingController;
  let access: AdminAccess;
  const auth = {
    ensureSession: vi.fn(() => of(undefined)),
    currentGeneration: () => 1,
    updateProfile: vi.fn(),
    status: () => 'signed-in',
  };
  beforeEach(() => {
    auth.ensureSession.mockReturnValue(of(undefined));
    auth.updateProfile.mockClear();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: Authentication, useValue: auth },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    access = TestBed.inject(AdminAccess);
  });
  afterEach(() => http.verify());
  it.each(['ADMIN', 'USER'])('reads the fresh profile for %s and updates presentation', (role) => {
    let result: unknown;
    access.check('/admin/workshops/new').subscribe((value) => (result = value));
    const request = http.expectOne('/api/auth/me');
    expect(request.request.context.get(REQUIRES_AUTH)).toBe(true);
    const profile = { id: '1', displayName: 'Current name', email: 'a@example.test', role };
    request.flush(profile);
    expect(auth.updateProfile).toHaveBeenCalledWith(profile, 1);
    expect(String(result)).toBe(role === 'ADMIN' ? 'true' : '/admin/access');
    if (role === 'USER') expect(access.retryable()).toBe(false);
  });
  it('redirects anonymous sessions to sign-in without a profile lookup', () => {
    auth.ensureSession.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 401 })));
    access.check('/admin/workshops').subscribe((value) => expect(String(value)).toBe('/login'));
    http.expectNone('/api/auth/me');
  });
  it('offers retry on outages without claiming incorrect credentials', () => {
    access
      .check('/admin/workshops/new')
      .subscribe((value) => expect(String(value)).toBe('/admin/access'));
    http.expectOne('/api/auth/me').flush({}, { status: 503, statusText: 'Unavailable' });
    expect(access.retryable()).toBe(true);
    expect(access.message()).toContain('could not be checked');
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    access.retry();
    expect(navigate).toHaveBeenCalledWith('/admin/workshops/new');
  });
  it('drops stale checks after an account transition', () => {
    access.check('/admin/workshops').subscribe((value) => expect(String(value)).toBe('/login'));
    vi.spyOn(auth, 'currentGeneration').mockReturnValueOnce(2);
    http.expectOne('/api/auth/me').flush({ role: 'ADMIN' });
    expect(auth.updateProfile).not.toHaveBeenCalled();
  });
  it.each(['/admin/users?page=2&search=learner', '/admin/workshops/opaque/edit'])(
    'preserves allowlisted retry destination %s',
    (destination) => {
      access.check(destination).subscribe();
      http.expectOne('/api/auth/me').flush({}, { status: 503, statusText: 'Unavailable' });
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
      access.retry();
      expect(navigate).toHaveBeenCalledWith(destination);
    },
  );
  it.each([
    'https://example.test/admin/users',
    '//example.test/admin/users',
    '/admin/users-extra',
    '/admin/access',
    '/admin/workshops-extra',
  ])('rejects unsupported retry destination %s', (destination) => {
    access.check(destination).subscribe();
    http.expectOne('/api/auth/me').flush({}, { status: 503, statusText: 'Unavailable' });
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    access.retry();
    expect(navigate).toHaveBeenCalledWith('/admin/workshops');
  });
});
