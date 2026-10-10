import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { routes } from '../app.routes';
import { FormGroup } from '@angular/forms';

describe('Registration form', () => {
  let http: HttpTestingController;
  let harness: RouterTestingHarness;
  const text = () => harness.routeNativeElement!.textContent ?? '';
  const fieldInput = (name: string) =>
    harness.routeNativeElement!.querySelector<HTMLInputElement>(`[formControlName="${name}"]`)!;
  const expectFieldError = (name: string, message: string) => {
    const element = fieldInput(name);
    expect(element.classList.contains('p-invalid')).toBe(true);
    expect(element.getAttribute('aria-invalid')).toBe('true');
    expect(element.getAttribute('aria-describedby')!.split(' ')).toContain(`${name}-error`);
    expect(harness.routeNativeElement!.querySelector(`#${name}-error`)!.textContent).toContain(
      message,
    );
  };
  const input = (name: string, value: string) => {
    const element = fieldInput(name);
    element.value = value;
    element.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const submit = () => {
    harness
      .routeNativeElement!.querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    harness.detectChanges();
  };
  const fill = () => {
    input('displayName', ' Learner ');
    input('email', ' Learner@Example.test ');
    input('password', ' a sufficiently long password ');
    input('confirmation', ' a sufficiently long password ');
  };
  const render = async () => {
    harness.detectChanges();
    await harness.fixture.whenStable();
    harness.detectChanges();
  };
  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [provideRouter(routes), provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    harness = await RouterTestingHarness.create('/register');
    await render();
  });
  afterEach(() => http.verify());
  it('requires valid fields and matching confirmation without sending a request', async () => {
    for (const name of ['displayName', 'email', 'password', 'confirmation']) {
      const element = fieldInput(name);
      const label = harness.routeNativeElement!.querySelector<HTMLLabelElement>(
        `label[for="${element.id}"]`,
      )!;
      expect(label.control).toBe(element);
      expect(element.classList.contains('p-invalid')).toBe(false);
      expect(element.getAttribute('aria-invalid')).toBe('false');
      expect(element.getAttribute('aria-describedby')).toBe(
        name === 'password' ? 'password-help' : null,
      );
    }
    submit();
    await render();
    expectFieldError('displayName', 'Enter a name');
    expectFieldError('email', 'Enter a valid email');
    expectFieldError('password', 'Use 15–128 characters');
    expectFieldError('confirmation', 'Passwords must match');
    fill();
    input('confirmation', 'different password');
    submit();
    await render();
    expectFieldError('confirmation', 'Passwords must match');
    expect(fieldInput('password').classList.contains('p-invalid')).toBe(false);
    expect(fieldInput('password').getAttribute('aria-describedby')).toBe('password-help');
    http.expectNone('/api/auth/register');
  });
  it('posts only the three fields, prevents duplicate submissions, clears passwords and disables success', async () => {
    fill();
    submit();
    submit();
    const pending = http.expectOne('/api/auth/register');
    expect(pending.request.method).toBe('POST');
    expect(pending.request.body).toEqual({
      displayName: 'Learner',
      email: 'learner@example.test',
      password: ' a sufficiently long password ',
    });
    expect(harness.routeNativeElement!.querySelector('fieldset')!.disabled).toBe(true);
    expect(fieldInput('email').matches(':disabled')).toBe(true);
    expect(fieldInput('password').type).toBe('password');
    expect(fieldInput('confirmation').type).toBe('password');
    expect(
      harness.routeNativeElement!.querySelector('button[type="submit"]')!.matches(':disabled'),
    ).toBe(true);
    pending.flush({
      id: 'fictional-id',
      displayName: 'Learner',
      email: 'learner@example.test',
      role: 'USER',
    });
    await render();
    expect(text()).toContain('Account created');
    const component = harness.routeDebugElement!.componentInstance as { form: FormGroup };
    expect(component.form.get('password')!.value).toBe('');
    expect(component.form.get('confirmation')!.value).toBe('');
    expect(component.form.disabled).toBe(true);
    expect(harness.routeNativeElement!.querySelector('a')!.getAttribute('href')).toBe('/workshops');
    expect(harness.routeNativeElement!.querySelector('a')!.classList.contains('p-button')).toBe(
      true,
    );
  });
  for (const [status, message] of [
    [409, 'An account with this email'],
    [429, 'Too many registration attempts'],
    [503, 'temporarily unavailable'],
    [500, 'Unable to create account'],
  ] as const) {
    it(`handles ${status} safely and allows another submission`, async () => {
      fill();
      submit();
      http
        .expectOne('/api/auth/register')
        .flush({ message: 'private driver details' }, { status, statusText: 'Failure' });
      await render();
      expect(text()).toContain(message);
      expect(text()).not.toContain('private driver');
      expect(fieldInput('email').matches(':disabled')).toBe(false);
      input('email', 'another@example.test');
      submit();
      http
        .expectOne('/api/auth/register')
        .flush({ id: 'id', displayName: 'Learner', email: 'another@example.test', role: 'USER' });
      await render();
      expect(text()).toContain('Account created');
    });
  }
  it('maps backend validation to known fields without showing raw messages', async () => {
    fill();
    submit();
    http
      .expectOne('/api/auth/register')
      .flush(
        { fieldErrors: { email: ['private detail'], password: ['private detail'] } },
        { status: 400, statusText: 'Bad Request' },
      );
    await render();
    expectFieldError('email', 'Please check your email');
    expectFieldError('password', 'Please check your password');
    expect(text()).not.toContain('private detail');
    input('email', 'corrected@example.test');
    await render();
    expect(fieldInput('email').classList.contains('p-invalid')).toBe(false);
    expect(fieldInput('email').getAttribute('aria-describedby')).toBe(null);
    expect(fieldInput('password').classList.contains('p-invalid')).toBe(false);
    expect(fieldInput('password').getAttribute('aria-describedby')).toBe('password-help');
  });
  it('counts Unicode code points rather than UTF-16 units', () => {
    fill();
    input('password', '😀'.repeat(14));
    input('confirmation', '😀'.repeat(14));
    submit();
    http.expectNone('/api/auth/register');
    input('password', '😀'.repeat(15));
    input('confirmation', '😀'.repeat(15));
    submit();
    http
      .expectOne('/api/auth/register')
      .flush({ id: 'id', displayName: 'Learner', email: 'learner@example.test', role: 'USER' });
  });
});
