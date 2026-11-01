import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { ManagementList } from './management-list';
describe('Workshop management list', () => {
  let http: HttpTestingController;
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());
  it('preserves public ordering and separate registration/availability even for historical closed workshops', async () => {
    const fixture = TestBed.createComponent(ManagementList);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Loading workshops');
    http.expectOne('/api/workshops').flush([
      {
        id: 'opaque',
        title: 'Past and full',
        startsAt: '2020-01-01T04:30:00Z',
        capacity: 10,
        reservedSeats: 10,
        availableSeats: 0,
        registrationOpen: false,
      },
    ]);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Past and full');
    expect(fixture.nativeElement.textContent).toContain('Closed');
    expect(fixture.nativeElement.textContent).toContain('0 available');
    expect(
      fixture.nativeElement.querySelector('a[href="/admin/workshops/opaque/edit"]'),
    ).not.toBeNull();
  });
  it('offers manual retry and an actionable empty state', async () => {
    const fixture = TestBed.createComponent(ManagementList);
    fixture.detectChanges();
    http.expectOne('/api/workshops').flush({}, { status: 503, statusText: 'Unavailable' });
    fixture.detectChanges();
    fixture.nativeElement.querySelector('button').click();
    http.expectOne('/api/workshops').flush([]);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('No workshops yet');
  });
});
