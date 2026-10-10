import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { Title } from '@angular/platform-browser';
import { routes } from '../app.routes';
import { workshopFixtures } from './workshop-fixtures.spec-helper';

describe('Workshop pages and routing', () => {
  let http: HttpTestingController;
  let harness: RouterTestingHarness;
  const text = () => harness.routeNativeElement?.textContent ?? '';
  async function render(): Promise<void> {
    harness.detectChanges();
    await harness.fixture.whenStable();
    harness.detectChanges();
  }
  async function open(path: string): Promise<void> {
    await harness.navigateByUrl(path);
    harness.detectChanges();
  }
  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [provideRouter(routes), provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    harness = await RouterTestingHarness.create();
  });
  afterEach(() => http.verify({ ignoreCancelled: true }));

  it('redirects the root to the list with its browser title and loading state', async () => {
    await open('/');
    expect(TestBed.inject(Router).url).toBe('/workshops');
    expect(TestBed.inject(Title).getTitle()).toBe('Workshops | SeatSafe');
    expect(text()).toContain('Loading workshops…');
    http.expectOne('/api/workshops').flush([]);
    await render();
    expect(text()).toContain('No workshops available.');
  });
  it('preserves API order and displays closed and sold-out rows', async () => {
    await open('/workshops');
    http.expectOne('/api/workshops').flush(workshopFixtures);
    await render();
    expect(
      Array.from(harness.routeNativeElement!.querySelectorAll('h2')).map((heading) =>
        heading.textContent?.trim(),
      ),
    ).toEqual(workshopFixtures.map((workshop) => workshop.title));
    expect(text()).toContain('Registration closed');
    expect(text()).toContain('Sold out');
    expect(text()).toContain('Sri Lanka time');
    expect(text()).toContain('3:30 pm');
    expect(harness.routeNativeElement!.querySelector('time')!.getAttribute('datetime')).toBe(
      workshopFixtures[0].startsAt,
    );
    expect(text()).toContain('of 20 seats available');
    expect(harness.routeNativeElement!.querySelector('h2 a')?.getAttribute('href')).toBe(
      '/workshops/workshop-2',
    );
  });
  it('shows a safe 503 and can retry successfully', async () => {
    await open('/workshops');
    http
      .expectOne('/api/workshops')
      .flush(
        { message: 'secret driver detail' },
        { status: 503, statusText: 'Service Unavailable' },
      );
    await render();
    expect(text()).toContain('Workshops are temporarily unavailable');
    expect(text()).not.toContain('secret driver detail');
    harness.routeNativeElement!.querySelector<HTMLButtonElement>('button')!.click();
    await render();
    expect(text()).toContain('Loading workshops…');
    http.expectOne('/api/workshops').flush(workshopFixtures);
    await render();
    expect(text()).toContain('Open workshop');
  });
  it('shows a generic message for a list network failure', async () => {
    await open('/workshops');
    http.expectOne('/api/workshops').error(new ProgressEvent('error'));
    await render();
    expect(text()).toContain('Unable to load workshops. Please try again.');
  });

  it.each(['/workshops', '/workshops/workshop-1'])(
    'hides raw non-503 HTTP errors on %s',
    async (path) => {
      await open(path);
      http
        .expectOne('/api' + path)
        .flush(
          { message: 'private error details' },
          { status: 500, statusText: 'Internal Server Error' },
        );
      await render();
      expect(text()).toContain('Unable to load');
      expect(text()).not.toContain('private error details');
    },
  );

  it('cancels a list request when the list is destroyed', async () => {
    await open('/workshops');
    const pending = http.expectOne('/api/workshops');
    await open('/not-a-page');
    expect(pending.cancelled).toBe(true);
  });
  it('navigates from a real list link to details and back', async () => {
    await open('/workshops');
    http.expectOne('/api/workshops').flush(workshopFixtures);
    await render();
    harness.routeNativeElement!.querySelector<HTMLAnchorElement>('h2 a')!.click();
    await render();
    expect(TestBed.inject(Router).url).toBe('/workshops/workshop-2');
    http.expectOne('/api/workshops/workshop-2').flush(workshopFixtures[0]);
    await render();
    expect(text()).toContain('Reserved seats');
    expect(text()).toContain('Registration closed');
    expect(TestBed.inject(Title).getTitle()).toBe('Workshop details | SeatSafe');
    harness.routeNativeElement!.querySelector<HTMLAnchorElement>('.back-link')!.click();
    await render();
    expect(TestBed.inject(Router).url).toBe('/workshops');
    http.expectOne('/api/workshops').flush([]);
    await render();
  });
  it('shows detail loading then the stored counts including sold-out status', async () => {
    await open('/workshops/workshop-3');
    expect(text()).toContain('Loading workshop…');
    http.expectOne('/api/workshops/workshop-3').flush(workshopFixtures[2]);
    await render();
    expect(text()).toContain('Sold out');
    expect(
      Array.from(harness.routeNativeElement!.querySelectorAll('dd')).map((element) =>
        element.textContent?.trim(),
      ),
    ).toEqual(['0', '12', '12']);
  });
  it('turns detail 404 into a not-found view with no retry', async () => {
    await open('/workshops/unknown');
    http.expectOne('/api/workshops/unknown').flush({}, { status: 404, statusText: 'Not Found' });
    await render();
    expect(text()).toContain('Workshop not found');
    expect(harness.routeNativeElement!.querySelector('button')).toBeNull();
  });
  it('recovers from a detail 503 through Retry', async () => {
    await open('/workshops/workshop-1');
    http
      .expectOne('/api/workshops/workshop-1')
      .flush({ message: 'internal SQL' }, { status: 503, statusText: 'Service Unavailable' });
    await render();
    expect(text()).toContain('Workshops are temporarily unavailable');
    expect(text()).not.toContain('internal SQL');
    harness.routeNativeElement!.querySelector<HTMLButtonElement>('button')!.click();
    await render();
    http.expectOne('/api/workshops/workshop-1').flush(workshopFixtures[1]);
    await render();
    expect(text()).toContain('Open workshop');
  });
  it('shows a generic message for a detail network failure', async () => {
    await open('/workshops/workshop-1');
    http.expectOne('/api/workshops/workshop-1').error(new ProgressEvent('error'));
    await render();
    expect(text()).toContain('Unable to load workshop. Please try again.');
  });
  it('cancels the old request when IDs change on the same component', async () => {
    await open('/workshops/workshop-1');
    const previousComponent = harness.routeDebugElement!.componentInstance;
    const earlier = http.expectOne('/api/workshops/workshop-1');
    await open('/workshops/workshop-2');
    expect(harness.routeDebugElement!.componentInstance).toBe(previousComponent);
    expect(earlier.cancelled).toBe(true);
    expect(() => earlier.flush(workshopFixtures[1])).toThrow();
    http.expectOne('/api/workshops/workshop-2').flush(workshopFixtures[0]);
    await render();
    expect(text()).toContain('Closed workshop');
    expect(text()).not.toContain('Open workshop');
  });
  it('clears previous successful details while the next ID loads', async () => {
    await open('/workshops/workshop-1');
    http.expectOne('/api/workshops/workshop-1').flush(workshopFixtures[1]);
    await render();
    await open('/workshops/workshop-2');
    expect(text()).toContain('Loading workshop…');
    expect(text()).not.toContain('Open workshop');
    http.expectOne('/api/workshops/workshop-2').flush(workshopFixtures[0]);
    await render();
  });
  it('keeps route changes working after a request fails', async () => {
    await open('/workshops/unknown');
    http.expectOne('/api/workshops/unknown').flush({}, { status: 404, statusText: 'Not Found' });
    await render();
    await open('/workshops/workshop-1');
    http.expectOne('/api/workshops/workshop-1').flush(workshopFixtures[1]);
    await render();
    expect(text()).toContain('Open workshop');
  });
  it('cancels a pending request when navigating away', async () => {
    await open('/workshops/workshop-1');
    const pending = http.expectOne('/api/workshops/workshop-1');
    await open('/does-not-exist');
    expect(pending.cancelled).toBe(true);
    expect(text()).toContain('Page not found');
  });
  it('shows a friendly frontend page-not-found screen without calling the API', async () => {
    await open('/unmatched/page');
    expect(text()).toContain('Page not found');
    expect(TestBed.inject(Title).getTitle()).toBe('Page not found | SeatSafe');
    expect(harness.routeNativeElement!.querySelector('a')?.getAttribute('href')).toBe('/workshops');
    http.expectNone('/api/workshops');
  });
});
