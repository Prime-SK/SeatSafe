import { TestBed } from '@angular/core/testing';
import { provideHttpClient, HttpErrorResponse } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { WorkshopsApi } from './workshops-api';
import { workshopFixtures } from './workshop-fixtures.spec-helper';

describe('WorkshopsApi', () => {
  let api: WorkshopsApi;
  let http: HttpTestingController;
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    api = TestBed.inject(WorkshopsApi);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());
  it('gets the list using a relative GET without reordering it', () => {
    const received = vi.fn();
    api.getWorkshops().subscribe(received);
    http.expectOne({ method: 'GET', url: '/api/workshops' }).flush(workshopFixtures);
    expect(received).toHaveBeenCalledWith(workshopFixtures);
  });
  it('encodes an opaque ID in a detail GET', () => {
    const received = vi.fn();
    api.getWorkshop('space / ?#').subscribe(received);
    http
      .expectOne({ method: 'GET', url: '/api/workshops/space%20%2F%20%3F%23' })
      .flush(workshopFixtures[0]);
    expect(received).toHaveBeenCalledWith(workshopFixtures[0]);
  });
  it('propagates HTTP failures for the page to handle', () => {
    const rejected = vi.fn();
    api.getWorkshops().subscribe({ error: rejected });
    http
      .expectOne('/api/workshops')
      .flush(
        { message: 'internal test detail' },
        { status: 503, statusText: 'Service Unavailable' },
      );
    expect(rejected.mock.calls[0][0]).toBeInstanceOf(HttpErrorResponse);
    expect(rejected.mock.calls[0][0].status).toBe(503);
  });
});
