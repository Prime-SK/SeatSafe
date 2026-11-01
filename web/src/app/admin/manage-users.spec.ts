import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import { signal } from '@angular/core';
import { BehaviorSubject, of, Subject } from 'rxjs';
import { By } from '@angular/platform-browser';
import { ConfirmationService } from 'primeng/api';
import type { Confirmation } from 'primeng/api';
import { ConfirmDialog } from 'primeng/confirmdialog';
import { Authentication, SessionStatus } from '../auth/authentication';
import { AdminAccess } from './admin-access';
import { AdminUsers, AdminUser } from './admin-users';
import { ManageUsers, userQuery } from './manage-users';
import { adminRoutes } from './admin.routes';
describe('User management page', () => {
  let fixture: ComponentFixture<ManageUsers>,
    http: HttpTestingController,
    params: BehaviorSubject<ReturnType<typeof convertToParamMap>>;
  const account = signal<{
      id: string;
      displayName: string;
      email: string;
      role: 'ADMIN' | 'USER';
    } | null>(null),
    status = signal<SessionStatus>('signed-in');
  let generation = 1;
  const logout = new Subject<void>();
  const auth = {
    account,
    status,
    message: signal('Safe session failure'),
    currentGeneration: () => generation,
    ensureSession: () => of(undefined),
    logoutStarted: logout.asObservable(),
  };
  const user: AdminUser = {
    id: 'target',
    displayName: 'Learner',
    email: 'learner@example.test',
    role: 'USER',
    isEnabled: true,
  };
  beforeEach(() => {
    generation = 1;
    account.set({ id: 'admin', displayName: 'Admin', email: 'a@example.test', role: 'ADMIN' });
    status.set('signed-in');
    params = new BehaviorSubject(convertToParamMap({ page: '1', limit: '25' }));
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: Authentication, useValue: auth },
        { provide: AdminAccess, useValue: { permissionLost: vi.fn() } },
        { provide: ActivatedRoute, useValue: { queryParamMap: params.asObservable() } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
  });
  afterEach(() => {
    try {
      http.verify({ ignoreCancelled: true });
    } finally {
      fixture?.destroy();
      document.querySelectorAll('main[data-user-focus-test]').forEach((main) => main.remove());
      vi.restoreAllMocks();
      TestBed.resetTestingModule();
    }
  });
  function read(url: string) {
    const active = http.match(url).filter((request) => !request.cancelled);
    expect(active).toHaveLength(1);
    return active[0]!;
  }
  async function render() {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }
  async function start(
    items: AdminUser[] = [user, { ...user, id: 'administrator', role: 'ADMIN' }],
  ) {
    fixture = TestBed.createComponent(ManageUsers);
    await render();
    read('/api/admin/users?page=1&limit=25').flush({
      items,
      total: items.length,
      page: 1,
      limit: 25,
    });
    await render();
  }
  const buttons = () =>
    Array.from(fixture.nativeElement.querySelectorAll('button')) as HTMLButtonElement[];
  const button = (text: string) => buttons().find((b) => b.textContent?.trim() === text)!;
  it('protects ADMIN rows and labels account actions explicitly', async () => {
    await start();
    expect(fixture.nativeElement.textContent).toContain('Protected administrator');
    expect(
      fixture.nativeElement.querySelectorAll(
        'button[aria-label="Disable account: learner@example.test"]',
      ).length,
    ).toBe(2);
    expect(fixture.nativeElement.querySelector('label[for="user-search"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('label[for="user-status"]')).not.toBeNull();
    expect(
      fixture.nativeElement.querySelector('[role="combobox"][aria-labelledby="user-status-label"]'),
    ).not.toBeNull();
  });
  it('shows validation only after blur/submission and focuses invalid search', async () => {
    await start();
    const input = fixture.nativeElement.querySelector('#user-search') as HTMLInputElement;
    input.value = '😀'.repeat(201);
    input.dispatchEvent(new Event('input'));
    await render();
    expect(fixture.nativeElement.querySelector('#search-error')).toBeNull();
    input.dispatchEvent(new Event('blur'));
    await render();
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toContain('search-error');
    fixture.nativeElement
      .querySelector('form')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await render();
    expect(document.activeElement).toBe(input);
    expect(TestBed.inject(Router).navigate).not.toHaveBeenCalled();
  });
  it('does not query while typing and applies both normalized filters on submit', async () => {
    await start();
    const component = fixture.componentInstance as unknown as { form: ManageUsers['form'] };
    component.form.setValue({ search: ' 雪 %_ ', status: 'disabled' });
    await render();
    http.expectNone((r) => r.url === '/api/admin/users');
    fixture.nativeElement
      .querySelector('form')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await render();
    expect(TestBed.inject(Router).navigate).toHaveBeenCalledWith([], {
      relativeTo: TestBed.inject(ActivatedRoute),
      queryParams: { page: 1, limit: 25, search: '雪 %_', status: 'disabled' },
    });
  });
  it('restores filters/results from URL changes and cancels obsolete reads', async () => {
    await start();
    params.next(
      convertToParamMap({ page: '2', limit: '10', search: 'current', status: 'enabled' }),
    );
    await render();
    const old = http.expectOne('/api/admin/users?page=2&limit=10&search=current&status=enabled');
    params.next(convertToParamMap({ page: '1', limit: '25', search: 'back' }));
    await render();
    expect(old.cancelled).toBe(true);
    http
      .expectOne('/api/admin/users?page=1&limit=25&search=back')
      .flush({ items: [], total: 0, page: 1, limit: 25 });
    await render();
    expect((fixture.nativeElement.querySelector('#user-search') as HTMLInputElement).value).toBe(
      'back',
    );
    expect(fixture.nativeElement.textContent).toContain('No matching accounts');
  });
  it('disables only after confirmation with Keep enabled as the safe default', async () => {
    await start();
    const confirm = vi.spyOn(fixture.debugElement.injector.get(ConfirmationService), 'confirm');
    button('Disable account').click();
    await render();
    const choice = confirm.mock.calls[0]![0];
    expect(choice.defaultFocus).toBe('reject');
    expect(choice.message).toContain('sessions will be revoked');
    expect(choice.rejectButtonProps?.label).toBe('Keep enabled');
    http.expectNone('/api/admin/users/target/status');
    choice.accept?.();
    await render();
    const write = http.expectOne('/api/admin/users/target/status');
    expect(write.request.body).toEqual({ isEnabled: false });
    write.flush({ ...user, isEnabled: false });
    await render();
    read('/api/admin/users?page=1&limit=25').flush({
      items: [{ ...user, isEnabled: false }],
      total: 1,
      page: 1,
      limit: 25,
    });
    await render();
    expect(fixture.nativeElement.textContent).toContain(
      'Account disabled and all sessions revoked',
    );
  });
  it('Escape rejects the actual dialog and returns focus without a request', async () => {
    await start();
    const trigger = button('Disable account');
    trigger.click();
    await render();
    const dialog = fixture.debugElement.query(By.directive(ConfirmDialog))
      .componentInstance as ConfirmDialog;
    expect(dialog.defaultFocus()).toBe('reject');
    expect(dialog.closeOnEscape()).toBe(true);
    const keep = Array.from(document.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Keep enabled',
    )!;
    keep.focus();
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }),
    );
    await render();
    http.expectNone('/api/admin/users/target/status');
    expect(document.activeElement).toBe(trigger);
  });
  it('restores stable heading focus after an accepted disable replaces its row', async () => {
    await start();
    const main = document.createElement('main');
    main.setAttribute('data-user-focus-test', '');
    const root = fixture.nativeElement as HTMLElement;
    root.parentNode!.insertBefore(main, root);
    main.append(root);
    button('Disable account').click();
    await render();
    const accept = Array.from(document.querySelectorAll('button'))
      .filter((b) => b.textContent?.trim() === 'Disable account')
      .at(-1)!;
    accept.focus();
    accept.click();
    await render();
    http.expectOne('/api/admin/users/target/status').flush({ ...user, isEnabled: false });
    await render();
    read('/api/admin/users?page=1&limit=25').flush({ items: [], total: 0, page: 1, limit: 25 });
    await render();
    expect(document.activeElement).toBe(main.querySelector('h1'));
  });
  it('enables directly without confirmation and explains fresh login', async () => {
    await start([{ ...user, isEnabled: false }]);
    const confirm = vi.spyOn(fixture.debugElement.injector.get(ConfirmationService), 'confirm');
    button('Enable account').click();
    http.expectOne('/api/admin/users/target/status').flush(user);
    await render();
    read('/api/admin/users?page=1&limit=25').flush({ items: [user], total: 1, page: 1, limit: 25 });
    await render();
    expect(confirm).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('Fresh sign-in is required');
  });
  it('requires deliberate read inspection after an uncertain write', async () => {
    await start([{ ...user, isEnabled: false }]);
    button('Enable account').click();
    http.expectOne('/api/admin/users/target/status').error(new ProgressEvent('error'));
    await render();
    http.expectNone((r) => r.url === '/api/admin/users');
    expect(TestBed.inject(AdminUsers).canAct()).toBe(false);
    button('Reload users').click();
    await render();
    read('/api/admin/users?page=1&limit=25').flush({ items: [user], total: 1, page: 1, limit: 25 });
    await render();
    expect(TestBed.inject(AdminUsers).canAct()).toBe(true);
  });
  it('distinguishes confirmed write from unavailable follow-up read', async () => {
    await start([{ ...user, isEnabled: false }]);
    button('Enable account').click();
    http.expectOne('/api/admin/users/target/status').flush(user);
    await render();
    read('/api/admin/users?page=1&limit=25').flush(
      { message: 'PRIVATE' },
      { status: 503, statusText: 'Unavailable' },
    );
    await render();
    expect(fixture.nativeElement.textContent).toContain('status change completed');
    expect(fixture.nativeElement.textContent).not.toContain('PRIVATE');
  });
  it('retains dispatched writes when the page is destroyed', async () => {
    await start([{ ...user, isEnabled: false }]);
    button('Enable account').click();
    const write = http.expectOne('/api/admin/users/target/status');
    fixture.destroy();
    expect(write.cancelled).toBe(false);
    write.flush(user);
    expect(TestBed.inject(AdminUsers).notice()?.kind).toBe('confirmed');
  });
  it('dismisses confirmation and clears account rows on logout, suppressing stale acceptance', async () => {
    await start();
    const confirm = vi.spyOn(fixture.debugElement.injector.get(ConfirmationService), 'confirm');
    button('Disable account').click();
    await render();
    const choice: Confirmation = confirm.mock.calls[0]![0];
    generation++;
    status.set('anonymous');
    account.set(null);
    logout.next();
    await render();
    expect(fixture.nativeElement.textContent).not.toContain(user.email);
    choice.accept?.();
    http.expectNone('/api/admin/users/target/status');
    expect(fixture.nativeElement.textContent).toContain('Please sign in again');
  });
  it.each([0, 10])(
    'moves an emptied confirmed page to the last valid page with total %i',
    async (total) => {
      await start([{ ...user, isEnabled: false }]);
      params.next(convertToParamMap({ page: '2', limit: '10', status: 'disabled' }));
      await render();
      http
        .expectOne('/api/admin/users?page=2&limit=10&status=disabled')
        .flush({ items: [{ ...user, isEnabled: false }], total: 11, page: 2, limit: 10 });
      await render();
      button('Enable account').click();
      http.expectOne('/api/admin/users/target/status').flush(user);
      await render();
      http
        .expectOne('/api/admin/users?page=2&limit=10&status=disabled')
        .flush({ items: [], total, page: 2, limit: 10 });
      await render();
      expect(TestBed.inject(Router).navigate).toHaveBeenCalledWith([], {
        relativeTo: TestBed.inject(ActivatedRoute),
        queryParams: { page: 1, limit: 10, status: 'disabled' },
        replaceUrl: true,
      });
    },
  );
  it('keeps unsent filter input through ordinary checking without an identity change', async () => {
    await start();
    const input = fixture.nativeElement.querySelector('#user-search') as HTMLInputElement;
    input.value = 'Draft search';
    input.dispatchEvent(new Event('input'));
    status.set('checking');
    await render();
    status.set('signed-in');
    await render();
    read('/api/admin/users?page=1&limit=25').flush({ items: [], total: 0, page: 1, limit: 25 });
    await render();
    expect(input.value).toBe('Draft search');
  });
  it.each([
    {},
    { page: ['1', '2'], limit: '101', status: 'all', search: '😀'.repeat(201) },
    { page: '0', limit: '11' },
  ])('normalizes invalid URL values %j', (value) => {
    expect(userQuery(convertToParamMap(value))).toEqual({ page: 1, limit: 25 });
  });
  it('registers a lazy guarded page with its browser title', () => {
    const route = adminRoutes.find((r) => r.path === 'users');
    expect(route?.title).toBe('Manage users | SeatSafe');
    expect(route?.canActivate).toHaveLength(1);
    expect(route?.loadComponent).toBeDefined();
  });
});
