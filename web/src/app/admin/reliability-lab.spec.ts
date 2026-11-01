import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import { BehaviorSubject, Observable, of, Subject, throwError } from 'rxjs';
import { ReliabilityLab } from './reliability-lab';
import { LabClient, LabReport } from './lab-client';
import { labFixture } from './lab-fixture.spec-helper';
import { Authentication } from '../auth/authentication';
import { AdminAccess } from './admin-access';
describe('Local reliability lab page', () => {
  let fixture: ComponentFixture<ReliabilityLab>,
    params: BehaviorSubject<ReturnType<typeof convertToParamMap>>;
  const report = signal<LabReport | null>(null),
    availability = signal('enabled'),
    pending = signal(false),
    message = signal(''),
    uncertain = signal(false),
    account = signal<{ id: string; role: string } | null>({ id: 'admin', role: 'ADMIN' }),
    status = signal('signed-in');
  const lab = {
    denied: signal(false),
    report,
    availability,
    pending,
    message,
    uncertain,
    enabled: () => availability() === 'enabled',
    checkAvailability: vi.fn(),
    clearMessage: () => message.set(''),
    start: vi.fn(),
    read: vi.fn<() => Observable<LabReport>>(() => of(labFixture)),
  };
  beforeEach(() => {
    report.set(null);
    availability.set('enabled');
    pending.set(false);
    message.set('');
    uncertain.set(false);
    account.set({ id: 'admin', role: 'ADMIN' });
    status.set('signed-in');
    lab.start.mockReset();
    lab.read.mockReset().mockReturnValue(of(labFixture));
    params = new BehaviorSubject(convertToParamMap({}));
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { queryParamMap: params.asObservable() } },
        { provide: LabClient, useValue: lab },
        { provide: AdminAccess, useValue: { permissionLost: vi.fn() } },
        { provide: Authentication, useValue: { account, status, currentGeneration: () => 1 } },
      ],
    });
    vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
  });
  afterEach(() => {
    fixture?.destroy();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });
  async function render() {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }
  async function start() {
    fixture = TestBed.createComponent(ReliabilityLab);
    await render();
  }
  const button = (label: string) =>
    Array.from(
      fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>,
    ).find((b) => b.textContent?.trim() === label)!;
  it('explains internal attempts and starts directly with a URL UUID', async () => {
    await start();
    button('Run selected demonstration').click();
    expect(lab.start).toHaveBeenCalledWith(
      expect.stringMatching(/^[a-f0-9-]{36}$/),
      'seat-contention',
    );
    expect(TestBed.inject(Router).navigate).toHaveBeenCalledWith([], {
      relativeTo: TestBed.inject(ActivatedRoute),
      queryParams: { run: expect.any(String) },
    });
    expect(fixture.nativeElement.textContent).toContain('not HTTP reservation requests');
  });
  it('blocks pending/uncertain starts and hides disabled controls', async () => {
    await start();
    pending.set(true);
    await render();
    expect(button('Run selected demonstration').disabled).toBe(true);
    pending.set(false);
    uncertain.set(true);
    await render();
    expect(button('Run selected demonstration').disabled).toBe(true);
    availability.set('disabled');
    await render();
    expect(fixture.nativeElement.textContent).toContain('enabled local development');
  });
  it('does not label incomplete outcomes as passed', async () => {
    await start();
    report.set({
      ...labFixture,
      status: 'incomplete',
      invariantsPassed: false,
      cleanup: 'failed',
      unexpected: 1,
    });
    await render();
    expect(fixture.nativeElement.textContent).toContain('incomplete');
    expect(fixture.nativeElement.textContent).toContain('not yet passed');
    expect(fixture.nativeElement.textContent).toContain('failed');
  });
  it('rejects invalid run links without starting or reading', async () => {
    params.next(convertToParamMap({ run: 'invalid' }));
    await start();
    expect(lab.start).not.toHaveBeenCalled();
    expect(lab.read).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('link is invalid');
  });
  it('reloads known IDs and stops at terminal reports', async () => {
    params.next(convertToParamMap({ run: labFixture.runId }));
    await start();
    await vi.waitFor(() => expect(lab.read).toHaveBeenCalledOnce());
    expect(lab.read).toHaveBeenCalledOnce();
    expect(lab.start).not.toHaveBeenCalled();
  });
  it('pauses failed reads until Check status', async () => {
    params.next(convertToParamMap({ run: labFixture.runId }));
    lab.read.mockImplementationOnce(() => {
      message.set('Run status unavailable');
      return throwError(() => Error('network'));
    });
    await start();
    await vi.waitFor(() => expect(lab.read).toHaveBeenCalledOnce());
    expect(lab.read).toHaveBeenCalledOnce();
    button('Check status').click();
    await render();
    await vi.waitFor(() => expect(lab.read).toHaveBeenCalledTimes(2));
    expect(lab.read).toHaveBeenCalledTimes(2);
    expect(lab.start).not.toHaveBeenCalled();
  });
  it('cancels an active status read when leaving', async () => {
    const subject = new Subject<LabReport>();
    let unsubscribed = false;
    lab.read.mockReturnValue(
      new Observable((subscriber) => {
        const subscription = subject.subscribe(subscriber);
        return () => {
          unsubscribed = true;
          subscription.unsubscribe();
        };
      }),
    );
    params.next(convertToParamMap({ run: labFixture.runId }));
    await start();
    await vi.waitFor(() => expect(lab.read).toHaveBeenCalledOnce());
    fixture.destroy();
    expect(unsubscribed).toBe(true);
  });
  it('does not overlap reads and pauses them when the page becomes hidden', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    const subject = new Subject<LabReport>();
    let unsubscribed = false;
    lab.read.mockReturnValue(
      new Observable((subscriber) => {
        const sub = subject.subscribe(subscriber);
        return () => {
          unsubscribed = true;
          sub.unsubscribe();
        };
      }),
    );
    params.next(convertToParamMap({ run: labFixture.runId }));
    fixture = TestBed.createComponent(ReliabilityLab);
    fixture.detectChanges();
    await vi.advanceTimersByTimeAsync(0);
    expect(lab.read).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(2500);
    expect(lab.read).toHaveBeenCalledOnce();
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    fixture.detectChanges();
    expect(unsubscribed).toBe(true);
    await vi.advanceTimersByTimeAsync(2000);
    expect(lab.read).toHaveBeenCalledOnce();
  });
});
