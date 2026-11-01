import { vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import type { DataSource } from 'typeorm';
import { LabService } from './lab.service.js';
import type { LabContext } from './lab-runner.js';
import { LabLocalGuard } from './lab.controller.js';
import type { ExecutionContext } from '@nestjs/common';
describe('Reliability lab run lifecycle', () => {
  function fixture() {
    const service = new LabService(
      {
        options: {
          type: 'postgres',
          host: 'localhost',
          database: 'seatsafe_dev',
        },
      } as DataSource,
      new ConfigService({ RELIABILITY_LAB_ENABLED: true }),
    );
    const create = vi
      .spyOn(service.runner, 'create')
      .mockReturnValue({} as LabContext);
    const prepare = vi.spyOn(service.runner, 'prepare').mockResolvedValue();
    const execute = vi
      .spyOn(service.runner, 'execute')
      .mockImplementation(async (_job, report) => {
        report.invariantsPassed = true;
      });
    const cleanup = vi.spyOn(service.runner, 'cleanup').mockResolvedValue();
    return { service, create, prepare, execute, cleanup };
  }
  const id = '858f1ab0-5901-4ab8-ae49-b652d8bf9602';
  async function settled(service: LabService) {
    await vi.waitFor(() =>
      expect(service.read('admin', id).status).not.toBe('running'),
    );
  }
  it('completes only after cleanup and returns detached reports', async () => {
    const f = fixture();
    let release!: () => void;
    f.cleanup.mockImplementation(
      () => new Promise((resolve) => (release = resolve)),
    );
    const first = f.service.start('admin', id, 'seat-contention');
    first.message = 'changed';
    await vi.waitFor(() => expect(f.cleanup).toHaveBeenCalledOnce());
    expect(f.service.read('admin', id).status).toBe('running');
    expect(f.service.read('admin', id).message).not.toBe('changed');
    release();
    await settled(f.service);
    expect(f.service.read('admin', id)).toMatchObject({
      status: 'completed',
      cleanup: 'removed',
    });
  });
  it('deduplicates retained owner/run/scenario, conflicts and refuses a second active run', async () => {
    const f = fixture();
    f.service.start('admin', id, 'matching-key');
    expect(f.service.start('admin', id, 'matching-key').runId).toBe(id);
    expect(() => f.service.start('admin', id, 'seat-contention')).toThrow(
      'Run ID was already used',
    );
    expect(() => f.service.start('other', 'new', 'matching-key')).toThrow(
      'busy',
    );
    await settled(f.service);
    expect(f.create).toHaveBeenCalledOnce();
    expect(() => f.service.read('other', id)).toThrow('Lab run not found');
  });
  it.each(['prepare', 'execute'] as const)(
    'cleans up after %s failure without exposing details',
    async (stage) => {
      const f = fixture();
      f[stage].mockRejectedValue(Error('PRIVATE'));
      f.service.start('admin', id, 'matching-key');
      await settled(f.service);
      expect(f.cleanup).toHaveBeenCalledOnce();
      expect(JSON.stringify(f.service.read('admin', id))).not.toContain(
        'PRIVATE',
      );
      expect(f.service.read('admin', id).status).toBe('failed');
    },
  );
  it('blocks new starts after cleanup failure and retries owned cleanup at shutdown', async () => {
    const f = fixture();
    f.cleanup.mockRejectedValueOnce(Error('PRIVATE'));
    f.service.start('admin', id, 'matching-key');
    await settled(f.service);
    expect(f.service.read('admin', id).cleanup).toBe('failed');
    expect(() => f.service.start('admin', 'new', 'matching-key')).toThrow(
      'busy',
    );
    await f.service.onApplicationShutdown();
    expect(f.cleanup).toHaveBeenCalledTimes(2);
    expect(f.service.read('admin', id).cleanup).toBe('removed');
  });
  it('retains only ten terminal reports', async () => {
    const f = fixture();
    for (let index = 0; index < 11; index++) {
      const runId = 'run-' + index;
      f.service.start('admin', runId, 'matching-key');
      await vi.waitFor(() =>
        expect(f.service.read('admin', runId).status).toBe('completed'),
      );
    }
    expect(() => f.service.read('admin', 'run-0')).toThrow('not found');
    expect(f.service.read('admin', 'run-10').status).toBe('completed');
  });
  it('reports differing observations as incomplete', async () => {
    const f = fixture();
    f.execute.mockResolvedValue();
    f.service.start('admin', id, 'seat-contention');
    await settled(f.service);
    expect(f.service.read('admin', id).status).toBe('incomplete');
  });
  it('waits for admitted work before shutdown cleanup and refuses new starts', async () => {
    const f = fixture();
    let release!: () => void;
    f.execute.mockImplementation(
      () => new Promise((resolve) => (release = resolve)),
    );
    f.service.start('admin', id, 'matching-key');
    await vi.waitFor(() => expect(f.execute).toHaveBeenCalledOnce());
    const closing = f.service.onApplicationShutdown();
    expect(() => f.service.start('other', 'new', 'matching-key')).toThrow(
      'busy',
    );
    expect(f.cleanup).not.toHaveBeenCalled();
    release();
    await closing;
    expect(f.cleanup).toHaveBeenCalledOnce();
  });
  it.each([
    ['127.0.0.1', true],
    ['::1', true],
    ['::ffff:127.0.0.1', true],
    ['203.0.113.10', false],
  ])(
    'checks socket locality %s without trusting forwarded headers',
    (address, allowed) => {
      const f = fixture(),
        guard = new LabLocalGuard(f.service);
      const context = {
        switchToHttp: () => ({
          getRequest: () => ({
            socket: { remoteAddress: address },
            headers: { 'x-forwarded-for': '127.0.0.1' },
          }),
        }),
      } as unknown as ExecutionContext;
      if (allowed) expect(guard.canActivate(context)).toBe(true);
      else expect(() => guard.canActivate(context)).toThrow('unavailable');
    },
  );
});
