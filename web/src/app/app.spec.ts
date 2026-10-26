import { TestBed } from '@angular/core/testing';
import { App } from './app';
import { routes } from './app.routes';
import { provideRouter, Router } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { Authentication } from './auth/authentication';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideRouter(routes), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
  });
  it('focuses a new route heading and leaves ordinary field interaction alone', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await TestBed.inject(Router).navigateByUrl('/login');
    await fixture.whenStable();
    const heading = fixture.nativeElement.querySelector('main h1');
    expect(document.activeElement).toBe(heading);
    const input = fixture.nativeElement.querySelector('input');
    input.focus();
    input.dispatchEvent(new Event('input', { bubbles: true }));
    fixture.detectChanges();
    await fixture.whenStable();
    expect(document.activeElement).toBe(input);
    await TestBed.inject(Router).navigateByUrl('/page-does-not-exist');
    await fixture.whenStable();
    expect(document.activeElement).toBe(fixture.nativeElement.querySelector('main h1'));
  });
  it('shows account presentation after login instead of anonymous links', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('a[href="/login"]')).toBeTruthy();
    TestBed.inject(Authentication)
      .login({ email: 'learner@example.test', password: 'unchanged' })
      .subscribe();
    TestBed.inject(HttpTestingController)
      .expectOne('/api/auth/login')
      .flush({
        accessToken: 'private-memory-fixture',
        tokenType: 'Bearer',
        expiresIn: 900,
        user: { id: 'user', displayName: 'Learner', email: 'learner@example.test', role: 'USER' },
      });
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Signed in as Learner');
    expect(fixture.nativeElement.querySelector('a[href="/login"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('a[href="/register"]')).toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain('private-memory-fixture');
    TestBed.inject(HttpTestingController).verify();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('renders the SeatSafe shell and navigation', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.brand')?.textContent).toContain('SeatSafe');
    expect(compiled.querySelector('nav a')?.getAttribute('href')).toBe('/workshops');
    expect(compiled.querySelector('main router-outlet')).toBeTruthy();
  });
});
