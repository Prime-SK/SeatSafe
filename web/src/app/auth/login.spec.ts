import { sessionTestingProvider } from './session-testing.spec-helper';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { FormGroup } from '@angular/forms';
import { routes } from '../app.routes';
import { Authentication } from './authentication';

describe('Login form', () => {
  let http: HttpTestingController;
  let harness: RouterTestingHarness;
  const root = () => harness.routeNativeElement!;
  const field = (name: string) =>
    root().querySelector<HTMLInputElement>(`[formControlName="${name}"]`)!;
  const input = (name: string, value: string) => {
    const element = field(name);
    element.value = value;
    element.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const submit = () => {
    root()
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    harness.detectChanges();
  };
  const render = async () => {
    harness.detectChanges();
    await harness.fixture.whenStable();
    harness.detectChanges();
  };
  const fill = () => {
    input('email', ' Learner@Example.test ');
    input('password', ' 🔐 unchanged password ');
  };
  const response = {
    accessToken: 'private-memory-fixture',
    tokenType: 'Bearer',
    expiresIn: 900,
    user: { id: 'user', displayName: 'Learner', email: 'learner@example.test', role: 'USER' },
  };
  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [
        sessionTestingProvider,
        provideRouter(routes),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpTestingController);
    harness = await RouterTestingHarness.create('/login');
    await render();
  });
  afterEach(() => http.verify());
  it('reveals errors on blur, updates them while editing and focuses the summary after submit', async () => {
    expect(root().querySelector('.error-summary')).toBeNull();
    expect(root().querySelector('#login-email-error')).toBeNull();
    field('email').dispatchEvent(new Event('blur'));
    await render();
    expect(root().querySelector('#login-email-error')?.textContent).toContain(
      'Enter your email address',
    );
    input('email', 'learner@example.test');
    await render();
    expect(root().querySelector('#login-email-error')).toBeNull();
    submit();
    await render();
    const summary = root().querySelector<HTMLElement>('.error-summary')!;
    expect(document.activeElement).toBe(summary);
    summary.querySelector<HTMLAnchorElement>('a')!.click();
    expect(document.activeElement).toBe(field('password'));
    http.expectNone('/api/auth/login');
  });
  it('toggles password visibility without changing its value or submitting', async () => {
    input('password', ' 🔐 exact password ');
    const toggle = root().querySelector<HTMLButtonElement>('[aria-label="Show password"]')!;
    toggle.click();
    await render();
    expect(field('password').type).toBe('text');
    expect(field('password').value).toBe(' 🔐 exact password ');
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    toggle.click();
    await render();
    expect(field('password').type).toBe('password');
    http.expectNone('/api/auth/login');
  });
  it('uses associated labels, PrimeNG invalid states, autocomplete and masked passwords', async () => {
    expect(document.title).toBe('Sign in | SeatSafe');
    for (const name of ['email', 'password']) {
      const element = field(name);
      expect(root().querySelector<HTMLLabelElement>(`label[for="${element.id}"]`)!.control).toBe(
        element,
      );
      expect(element.getAttribute('aria-invalid')).toBe('false');
    }
    expect(field('email').autocomplete).toBe('username');
    expect(field('password').autocomplete).toBe('current-password');
    expect(field('password').type).toBe('password');
    submit();
    await render();
    for (const name of ['email', 'password']) {
      const element = field(name);
      expect(element.classList.contains('p-invalid')).toBe(true);
      expect(element.getAttribute('aria-invalid')).toBe('true');
      expect(root().querySelector('#' + element.getAttribute('aria-describedby'))).toBeTruthy();
    }
    http.expectNone('/api/auth/login');
  });
  it.each(['x', ' ', '🔐'.repeat(128)])(
    'allows exact login passwords without registration policy: %s',
    async (password) => {
      input('email', ' learner@example.test ');
      input('password', password);
      submit();
      const req = http.expectOne('/api/auth/login');
      expect(req.request.body.password).toBe(password);
      req.flush({}, { status: 401, statusText: 'Unauthorized' });
      await render();
      expect(root().textContent).toContain('Invalid email or password');
    },
  );
  it.each(['', '🔐'.repeat(129)])(
    'rejects password length outside 1–128 characters: %s',
    (password) => {
      input('email', 'learner@example.test');
      input('password', password);
      submit();
      http.expectNone('/api/auth/login');
    },
  );
  it('posts exactly two normalized fields, blocks duplicate submission and navigates to workshops', async () => {
    fill();
    submit();
    submit();
    expect(root().querySelector('fieldset')!.disabled).toBe(true);
    expect(field('email').matches(':disabled')).toBe(true);
    expect(root().querySelector('button[type="submit"]')!.matches(':disabled')).toBe(true);
    const req = http.expectOne('/api/auth/login');
    expect(req.request.body).toEqual({
      email: 'learner@example.test',
      password: ' 🔐 unchanged password ',
    });
    const component = harness.routeDebugElement!.componentInstance as { form: FormGroup };
    req.flush(response);
    await render();
    http.expectOne('/api/workshops').flush([]);
    await render();
    expect(TestBed.inject(Router).url).toBe('/workshops');
    expect(component.form.get('password')!.value).toBe('');
    expect(TestBed.inject(Authentication).account()).toEqual(response.user);
    expect(root().textContent).not.toContain(response.accessToken);
  });
  it.each([400, 401, 403, 429, 500, 503, 0])(
    'shows safe feedback and permits retry after HTTP %s',
    async (status) => {
      fill();
      submit();
      const req = http.expectOne('/api/auth/login');
      if (status === 0) req.error(new ProgressEvent('error'));
      else
        req.flush(
          {
            message: 'private SQL/token',
            fieldErrors: {
              email: ['private email'],
              password: ['private password'],
              role: ['forged'],
            },
          },
          { status, statusText: 'Error' },
        );
      await render();
      expect(root().querySelector('[role="alert"]')).toBeTruthy();
      expect(root().textContent).not.toContain('private');
      expect(TestBed.inject(Authentication).authenticated()).toBe(false);
      expect(root().querySelector('fieldset')!.disabled).toBe(false);
      if (status === 400) {
        for (const name of ['email', 'password']) {
          expect(field(name).getAttribute('aria-invalid')).toBe('true');
        }
        input('email', 'different@example.test');
        await render();
        expect(field('password').classList.contains('p-invalid')).toBe(false);
      }
      submit();
      const retry = http.expectOne('/api/auth/login');
      retry.flush({}, { status: 401, statusText: 'Unauthorized' });
      http.expectNone('/api/auth/refresh');
    },
  );
  it('keeps a dispatched cookie login alive but clears the password and prevents late navigation', async () => {
    fill();
    submit();
    const req = http.expectOne('/api/auth/login');
    const component = harness.routeDebugElement!.componentInstance as { form: FormGroup };
    await harness.navigateByUrl('/register');
    expect(req.cancelled).toBe(false);
    req.flush(response);
    await render();
    expect(TestBed.inject(Router).url).toBe('/register');
    expect(component.form.get('password')!.value).toBe('');
    expect(TestBed.inject(Authentication).authenticated()).toBe(true);
  });
  it('shows the root-owned login in progress after returning to the login route', async () => {
    fill();
    submit();
    const request = http.expectOne('/api/auth/login');
    await harness.navigateByUrl('/register');
    await harness.navigateByUrl('/login');
    await render();
    expect(root().querySelector('form')).toBeNull();
    expect(root().textContent).toContain('Signing in');
    request.flush(response);
    await render();
    expect(TestBed.inject(Router).url).toBe('/login');
    expect(root().textContent).toContain('You’re signed in as Learner');
    http.expectNone('/api/auth/login');
    http.expectNone('/api/workshops');
  });
  it('shows account status instead of a form when already signed in', async () => {
    TestBed.inject(Authentication)
      .login({ email: 'learner@example.test', password: 'unchanged' })
      .subscribe();
    http.expectOne('/api/auth/login').flush(response);
    await render();
    expect(root().querySelector('form')).toBeNull();
    expect(root().textContent).toContain('You’re signed in as Learner');
    expect(root().querySelector('a[href="/workshops"]')).toBeTruthy();
  });
  it('keeps registration independent and links its successful result to sign in', async () => {
    await harness.navigateByUrl('/register');
    await render();
    const set = (name: string, value: string) => {
      const element = root().querySelector<HTMLInputElement>(`[formControlName="${name}"]`)!;
      element.value = value;
      element.dispatchEvent(new Event('input', { bubbles: true }));
    };
    set('displayName', 'Learner');
    set('email', 'learner@example.test');
    set('password', 'sufficiently long password');
    set('confirmation', 'sufficiently long password');
    submit();
    http.expectOne('/api/auth/register').flush(response.user);
    await render();
    expect(TestBed.inject(Authentication).authenticated()).toBe(false);
    expect(root().querySelector('a[href="/login"]')).toBeTruthy();
    http.expectNone('/api/auth/login');
  });
});
