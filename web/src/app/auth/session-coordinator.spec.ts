import { TestBed } from '@angular/core/testing';
import { Subject, firstValueFrom, of } from 'rxjs';
import { SessionCoordinator } from './session-coordinator';
class Channel {
  static instances: Channel[] = [];
  onmessage: ((event: { data: unknown }) => void) | null = null;
  closed = false;
  sent: unknown[] = [];
  constructor(readonly name: string) {
    Channel.instances.push(this);
  }
  postMessage(data: unknown): void {
    this.sent.push(data);
    for (const other of Channel.instances)
      if (other !== this && !other.closed && other.name === this.name) other.onmessage?.({ data });
  }
  close(): void {
    this.closed = true;
  }
}
describe('Browser cookie-operation coordinator', () => {
  let tail: Promise<unknown>;
  beforeEach(() => {
    Channel.instances = [];
    tail = Promise.resolve();
    vi.stubGlobal('isSecureContext', true);
    vi.stubGlobal('BroadcastChannel', Channel);
    vi.stubGlobal('navigator', {
      locks: {
        request: vi.fn((_name: string, operation: () => Promise<unknown>) => {
          const task = tail.then(operation);
          tail = task.catch(() => undefined);
          return task;
        }),
      },
    });
    TestBed.configureTestingModule({});
  });
  afterEach(() => {
    TestBed.resetTestingModule();
    vi.unstubAllGlobals();
  });
  it('serializes operations from different tabs until their requests finish', async () => {
    const first = TestBed.runInInjectionContext(() => new SessionCoordinator());
    const second = TestBed.runInInjectionContext(() => new SessionCoordinator());
    expect(first.supported).toBe(true);
    const pending = new Subject<string>();
    const order: string[] = [];
    const a = firstValueFrom(
      first.run(() => {
        order.push('first');
        return pending;
      }),
    );
    const b = firstValueFrom(
      second.run(() => {
        order.push('second');
        return of('two');
      }),
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(order).toEqual(['first']);
    pending.next('one');
    expect(await a).toBe('one');
    expect(await b).toBe('two');
    expect(order).toEqual(['first', 'second']);
  });
  it('releases the lock after a rejected operation', async () => {
    const coordinator = TestBed.inject(SessionCoordinator);
    const a = firstValueFrom(
      coordinator.run(() => {
        throw new Error('Fixture failure');
      }),
    );
    await expect(a).rejects.toThrow('Fixture failure');
    await expect(firstValueFrom(coordinator.run(() => of('recovered')))).resolves.toBe('recovered');
  });
  it('transmits only known lifecycle strings and ignores malformed messages', () => {
    const first = TestBed.runInInjectionContext(() => new SessionCoordinator());
    const second = TestBed.runInInjectionContext(() => new SessionCoordinator());
    const seen: string[] = [];
    second.notices.subscribe((value) => seen.push(value));
    first.announce('session-changed');
    first.announce('logout-completed');
    Channel.instances[1].onmessage?.({ data: { accessToken: 'untrusted' } });
    Channel.instances[1].onmessage?.({ data: 'unknown' });
    expect(seen).toEqual(['session-changed', 'logout-completed']);
    expect(Channel.instances[0].sent).toEqual(seen);
  });
  it('closes browser channels on application destruction', () => {
    TestBed.inject(SessionCoordinator);
    TestBed.resetTestingModule();
    expect(Channel.instances[0].closed).toBe(true);
  });
  it.each(['insecure', 'missing-channel'])(
    'requires complete secure browser coordination: %s',
    async (mode) => {
      if (mode === 'insecure') vi.stubGlobal('isSecureContext', false);
      else vi.stubGlobal('BroadcastChannel', undefined);
      const coordinator = TestBed.inject(SessionCoordinator);
      expect(coordinator.supported).toBe(false);
      await expect(firstValueFrom(coordinator.run(() => of('unsafe')))).rejects.toThrow(
        'unavailable',
      );
    },
  );
  it('does not run a mutation when Web Locks are unavailable', async () => {
    vi.stubGlobal('navigator', {});
    const coordinator = TestBed.inject(SessionCoordinator);
    const operation = vi.fn(() => of('unsafe'));
    expect(coordinator.supported).toBe(false);
    await expect(firstValueFrom(coordinator.run(operation))).rejects.toThrow('unavailable');
    expect(operation).not.toHaveBeenCalled();
  });
});
