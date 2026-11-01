import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormGroup } from '@angular/forms';
import { HttpClient, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { ConfirmationService } from 'primeng/api';
import { Authentication } from '../auth/authentication';
import { WorkshopEditor } from './workshop-editor';
import { AdminWorkshopsApi } from './admin-workshops-api';
import { AdminAccess } from './admin-access';
import { REQUIRES_AUTH } from '../auth/auth-interceptor';
describe('Workshop editor', () => {
  let fixture: ComponentFixture<WorkshopEditor>;
  let http: HttpTestingController;
  let generation: number;
  let auth: {
    account: ReturnType<typeof signal<{ role: string } | null>>;
    status: ReturnType<typeof signal<string>>;
    currentGeneration: () => number;
    updateProfile: ReturnType<typeof vi.fn>;
  };
  const workshop = {
    id: 'opaque',
    title: 'Old title',
    capacity: 10,
    reservedSeats: 3,
    availableSeats: 7,
    registrationOpen: true,
    startsAt: '2020-01-01T04:30:17.123Z',
  };
  const render = async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };
  const form = () => (fixture.componentInstance as unknown as { form: FormGroup }).form;
  const submit = () => {
    fixture.nativeElement
      .querySelector('form')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    fixture.detectChanges();
  };
  async function setup(id: string | null = null) {
    generation = 1;
    auth = {
      account: signal<{ role: string } | null>({ role: 'ADMIN' }),
      status: signal('signed-in'),
      currentGeneration: () => generation,
      updateProfile: vi.fn(),
    };
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: Authentication, useValue: auth },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: convertToParamMap(id ? { id } : {}) } },
        },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    fixture = TestBed.createComponent(WorkshopEditor);
    if (id) http.expectOne('/api/workshops/opaque').flush(workshop);
    await render();
  }
  afterEach(() => {
    http?.verify();
  });
  it('starts blank without errors, then focuses summary and the real labelled inputs', async () => {
    await setup();
    expect(fixture.nativeElement.querySelector('.error-summary')).toBeNull();
    submit();
    await render();
    expect(document.activeElement).toBe(fixture.nativeElement.querySelector('.error-summary'));
    for (const field of ['title', 'capacity', 'schedule']) {
      const input = fixture.nativeElement.querySelector(`#${field}`);
      expect(input.tagName).toBe('INPUT');
      expect(fixture.nativeElement.querySelector(`label[for="${field}"]`)).not.toBeNull();
      expect(input.getAttribute('aria-describedby')).toContain(`${field}-error`);
      fixture.nativeElement.querySelector(`a[href="#${field}"]`).click();
      expect(document.activeElement).toBe(input);
    }
    http.expectNone('/api/admin/workshops');
  });
  it('validates only after blur, then updates on editing', async () => {
    await setup();
    const title = fixture.nativeElement.querySelector('#title');
    title.dispatchEvent(new Event('blur'));
    await render();
    expect(fixture.nativeElement.querySelector('#title-error')).not.toBeNull();
    form().controls['title'].setValue('Valid');
    await render();
    expect(fixture.nativeElement.querySelector('#title-error')).toBeNull();
  });
  it('creates with exactly four fields, disables controls and prevents duplicates', async () => {
    await setup();
    form().setValue({
      title: ' 😀 ',
      capacity: 12,
      schedule: new Date(2035, 5, 21, 14, 45),
      registrationOpen: true,
    });
    submit();
    submit();
    const request = http.expectOne('/api/admin/workshops');
    expect(request.request.body).toEqual({
      title: '😀',
      capacity: 12,
      startsAt: '2035-06-21T09:15:00.000Z',
      registrationOpen: true,
    });
    expect(request.request.context.get(REQUIRES_AUTH)).toBe(true);
    expect(form().disabled).toBe(true);
    expect(fixture.componentInstance.canLeave()).toBe(false);
    request.flush({ ...workshop, id: 'created' });
    await render();
    expect(TestBed.inject(AdminWorkshopsApi).notice()).toBe('Workshop created.');
    expect(TestBed.inject(Router).navigateByUrl).toHaveBeenCalledWith('/admin/workshops');
  });
  it('omits unchanged historical schedule/registration and disables unchanged saves', async () => {
    await setup('opaque');
    expect(fixture.nativeElement.querySelector('button[type="submit"]').disabled).toBe(true);
    form().controls['title'].setValue(' New title ');
    submit();
    const request = http.expectOne('/api/admin/workshops/opaque');
    expect(request.request.method).toBe('PATCH');
    expect(request.request.body).toEqual({ title: 'New title' });
    request.flush(workshop);
    await render();
  });
  it('blocks invalid typed dates even after a valid date was selected', async () => {
    await setup('opaque');
    const input = fixture.nativeElement.querySelector('#schedule');
    input.value = '31/02/2035 14:45';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    submit();
    await render();
    expect(fixture.nativeElement.querySelector('#schedule-error').textContent).toContain(
      'valid Sri Lanka',
    );
    http.expectNone('/api/admin/workshops/opaque');
  });
  it('accepts pasted valid Colombo dates without relying on a preceding keydown', async () => {
    await setup();
    form().patchValue({ title: 'Pasted schedule', capacity: 8 });
    const input = fixture.nativeElement.querySelector('#schedule');
    input.value = '21/06/2035 14:45';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    submit();
    const request = http.expectOne('/api/admin/workshops');
    expect(request.request.body.startsAt).toBe('2035-06-21T09:15:00.000Z');
    request.flush(workshop);
    await render();
  });
  it('warns on browser close for drafts and bypasses it after logout begins', async () => {
    await setup('opaque');
    form().controls['title'].setValue('Draft');
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    generation++;
    auth.account.set(null);
    auth.status.set('signing-out');
    await render();
    const next = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(next);
    expect(next.defaultPrevented).toBe(false);
  });
  it('confirms before reloading conflicts and retains the draft on Keep editing', async () => {
    await setup('opaque');
    form().controls['capacity'].setValue(4);
    submit();
    http
      .expectOne('/api/admin/workshops/opaque')
      .flush({ code: 'CAPACITY_BELOW_RESERVED' }, { status: 409, statusText: 'Conflict' });
    await render();
    const confirmation = vi.spyOn(
      fixture.debugElement.injector.get(ConfirmationService),
      'confirm',
    );
    const reload = () =>
      (fixture.componentInstance as unknown as { reload(): Promise<void> }).reload();
    const kept = reload();
    confirmation.mock.calls[0][0].reject!();
    await kept;
    await render();
    http.expectNone('/api/workshops/opaque');
    expect(form().controls['capacity'].value).toBe(4);
    const discarded = reload();
    confirmation.mock.calls[1][0].accept!();
    await discarded;
    http
      .expectOne('/api/workshops/opaque')
      .flush({ ...workshop, reservedSeats: 5, availableSeats: 5 });
    await render();
    expect(form().controls['capacity'].value).toBe(10);
  });
  it('keeps a draft while the same identity refreshes its token', async () => {
    await setup('opaque');
    form().controls['title'].setValue('Draft');
    auth.status.set('checking');
    await render();
    auth.status.set('signed-in');
    await render();
    expect(form().controls['title'].value).toBe('Draft');
  });
  it('retains drafts and maps safe conflict feedback, never raw server text', async () => {
    await setup('opaque');
    form().controls['capacity'].setValue(4);
    submit();
    http
      .expectOne('/api/admin/workshops/opaque')
      .flush(
        { code: 'CAPACITY_BELOW_RESERVED', message: 'private raw detail' },
        { status: 409, statusText: 'Conflict' },
      );
    await render();
    expect(form().controls['capacity'].value).toBe(4);
    expect(form().enabled).toBe(true);
    expect(fixture.nativeElement.textContent).toContain('Reload current values');
    expect(fixture.nativeElement.textContent).not.toContain('private raw detail');
  });
  it('explains ambiguous network outcomes without replaying the write', async () => {
    await setup('opaque');
    form().controls['title'].setValue('Draft');
    submit();
    http.expectOne('/api/admin/workshops/opaque').error(new ProgressEvent('error'));
    await render();
    expect(fixture.nativeElement.textContent).toContain('Saving could not be confirmed');
    expect(form().controls['title'].value).toBe('Draft');
    http.expectNone('/api/admin/workshops/opaque');
  });
  it('warns for actual unsaved changes and defaults to Keep editing', async () => {
    await setup('opaque');
    form().controls['title'].setValue('Draft');
    const confirmation = vi.spyOn(
      fixture.debugElement.injector.get(ConfirmationService),
      'confirm',
    );
    const decision = fixture.componentInstance.canLeave() as Promise<boolean>;
    await render();
    expect(confirmation.mock.calls[0][0].defaultFocus).toBe('reject');
    confirmation.mock.calls[0][0].reject!();
    expect(await decision).toBe(false);
    form().controls['title'].setValue('Old title');
    await render();
    expect(await fixture.componentInstance.canLeave()).toBe(true);
  });
  it('keeps a dispatched save alive after destruction but suppresses navigation', async () => {
    await setup();
    form().setValue({
      title: 'Draft',
      capacity: 4,
      schedule: new Date(2035, 5, 21),
      registrationOpen: true,
    });
    submit();
    const request = http.expectOne('/api/admin/workshops');
    fixture.destroy();
    expect(request.cancelled).toBe(false);
    request.flush(workshop);
    expect(TestBed.inject(Router).navigateByUrl).not.toHaveBeenCalled();
    expect(TestBed.inject(AdminWorkshopsApi).saving()).toBe(false);
  });
  it('clears drafts on identity changes and suppresses late save results', async () => {
    await setup('opaque');
    form().controls['title'].setValue('Draft');
    submit();
    const request = http.expectOne('/api/admin/workshops/opaque');
    generation++;
    auth.account.set(null);
    auth.status.set('signing-out');
    await render();
    expect(form().controls['title'].value).toBe('');
    expect(await fixture.componentInstance.canLeave()).toBe(true);
    request.flush(workshop);
    await render();
    expect(TestBed.inject(AdminWorkshopsApi).notice()).toBe('');
  });
  it('clears drafts on later permission loss and does not retry the write', async () => {
    await setup('opaque');
    form().controls['title'].setValue('Draft');
    submit();
    http
      .expectOne('/api/admin/workshops/opaque')
      .flush({}, { status: 403, statusText: 'Forbidden' });
    http
      .expectOne('/api/auth/me')
      .flush({ id: '1', role: 'USER', displayName: 'User', email: 'u@example.test' });
    await render();
    expect(form().controls['title'].value).toBe('');
    expect(TestBed.inject(AdminAccess).retryable()).toBe(false);
    http.expectNone('/api/admin/workshops/opaque');
  });
});
