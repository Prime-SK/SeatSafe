import { vi } from 'vitest';
import type { DataSource, EntityManager } from 'typeorm';
import { AdminUsersService } from './admin-users.service.js';
import { UserEntity } from '../users/user.entity.js';
import { RegistrationError } from '../auth/registration-error.js';

describe('Administrator user service', () => {
  const principal = {
    id: 'actor',
    sessionId: 'session',
    displayName: 'Admin',
    email: 'admin@example.test',
    role: 'ADMIN' as const,
  };
  const actor = { ...principal, isEnabled: true };
  const target = {
    id: 'target',
    displayName: 'Learner',
    email: 'learner@example.test',
    role: 'USER',
    isEnabled: true,
  };
  function fixture() {
    const currentTarget = { ...target };
    const query = {
      select: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      getCount: vi.fn().mockResolvedValue(1),
      orderBy: vi.fn().mockReturnThis(),
      addOrderBy: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      take: vi.fn().mockReturnThis(),
      getMany: vi.fn().mockResolvedValue([currentTarget]),
    };
    const users = {
      findOne: vi
        .fn()
        .mockResolvedValueOnce(actor)
        .mockResolvedValue(currentTarget),
      findOneBy: vi.fn().mockResolvedValue(currentTarget),
      update: vi.fn().mockResolvedValue({ affected: 1 }),
      createQueryBuilder: vi.fn().mockReturnValue(query),
    };
    const sessions = {
      findOneBy: vi.fn().mockResolvedValue({
        revokedAt: null,
        expiresAt: new Date(Date.now() + 60000),
      }),
      update: vi.fn().mockResolvedValue({ affected: 2 }),
    };
    const manager = {
      query: vi.fn().mockResolvedValue([]),
      getRepository: vi.fn((entity: unknown) =>
        entity === UserEntity ? users : sessions,
      ),
    };
    const transaction = vi.fn(async (...args: unknown[]) =>
      (args.at(-1) as (m: EntityManager) => Promise<unknown>)(
        manager as unknown as EntityManager,
      ),
    );
    const service = new AdminUsersService({
      transaction,
    } as unknown as DataSource);
    return { service, transaction, manager, users, sessions, query };
  }
  it('uses a read-only repeatable snapshot and explicit safe projection', async () => {
    const f = fixture();
    expect(
      await f.service.list({
        page: 2,
        limit: 10,
        search: 'a%_!雪',
        status: 'disabled',
      }),
    ).toEqual({ items: [target], total: 1, page: 2, limit: 10 });
    expect(f.transaction.mock.calls[0][0]).toBe('REPEATABLE READ');
    expect(f.manager.query).toHaveBeenCalledWith('SET TRANSACTION READ ONLY');
    expect(f.query.select).toHaveBeenCalledWith([
      'user.id',
      'user.displayName',
      'user.email',
      'user.role',
      'user.isEnabled',
    ]);
    expect(f.query.andWhere).toHaveBeenCalledWith(
      expect.stringContaining('ILIKE'),
      { search: '%a!%!_!!雪%' },
    );
    expect(f.query.andWhere).toHaveBeenCalledWith('user.isEnabled = :enabled', {
      enabled: false,
    });
    expect(f.query.skip).toHaveBeenCalledWith(10);
    expect(f.users.update).not.toHaveBeenCalled();
  });
  it('locks actor then target, rechecks session and revokes all target sessions', async () => {
    const f = fixture();
    expect(await f.service.update(principal, 'target', false)).toEqual({
      ...target,
      isEnabled: false,
    });
    expect(f.users.findOne.mock.calls.map((call) => call[0])).toEqual([
      { where: { id: 'actor' }, lock: { mode: 'pessimistic_write' } },
      { where: { id: 'target' }, lock: { mode: 'pessimistic_write' } },
    ]);
    expect(f.sessions.findOneBy).toHaveBeenCalledTimes(2);
    expect(f.sessions.update).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'target' }),
      { revokedAt: expect.any(Date) },
    );
  });
  it('does not update unchanged enabled accounts or resurrect sessions', async () => {
    const f = fixture();
    await f.service.update(principal, 'target', true);
    expect(f.users.update).not.toHaveBeenCalled();
    expect(f.sessions.update).not.toHaveBeenCalled();
  });
  it('rechecks sessions after target lock waits', async () => {
    const f = fixture();
    f.sessions.findOneBy
      .mockResolvedValueOnce({
        revokedAt: null,
        expiresAt: new Date(Date.now() + 60000),
      })
      .mockResolvedValueOnce({ revokedAt: null, expiresAt: new Date(0) });
    await expect(
      f.service.update(principal, 'target', false),
    ).rejects.toMatchObject({ status: 401 });
    expect(f.users.update).not.toHaveBeenCalled();
  });
  it.each([null, { ...actor, isEnabled: false }])(
    'rejects missing/disabled actors',
    async (value) => {
      const f = fixture();
      f.users.findOne.mockReset().mockResolvedValue(value);
      await expect(
        f.service.update(principal, 'target', false),
      ).rejects.toMatchObject({ status: 401 });
    },
  );
  it('requires the current database ADMIN role', async () => {
    const f = fixture();
    f.users.findOne.mockReset().mockResolvedValue({ ...actor, role: 'USER' });
    await expect(
      f.service.update(principal, 'target', false),
    ).rejects.toMatchObject({ status: 403 });
  });
  it('protects ADMIN targets without acquiring a second administrator lock', async () => {
    const f = fixture();
    f.users.findOneBy.mockResolvedValue({ ...target, role: 'ADMIN' });
    await expect(
      f.service.update(principal, 'target', false),
    ).rejects.toMatchObject({ status: 409 });
    expect(f.users.findOne).toHaveBeenCalledTimes(1);
  });
  it('rechecks the target role under lock', async () => {
    const f = fixture();
    f.users.findOne
      .mockReset()
      .mockResolvedValueOnce(actor)
      .mockResolvedValueOnce({ ...target, role: 'ADMIN' });
    await expect(
      f.service.update(principal, 'target', false),
    ).rejects.toMatchObject({ status: 409 });
  });
  it('returns safe missing account feedback', async () => {
    const f = fixture();
    f.users.findOne
      .mockReset()
      .mockResolvedValueOnce(actor)
      .mockResolvedValueOnce(null);
    await expect(
      f.service.update(principal, 'target', false),
    ).rejects.toMatchObject({ status: 404 });
  });
  it('maps persistence and commit failures to safe 503', async () => {
    const f = fixture();
    f.users.update.mockRejectedValue(Error('private SQL'));
    await expect(
      f.service.update(principal, 'target', false),
    ).rejects.toMatchObject({ status: 503 });
    f.transaction.mockRejectedValue(Error('private commit'));
    await expect(f.service.list({ page: 1, limit: 25 })).rejects.toMatchObject({
      status: 503,
    });
  });
  it('maps unexpected response construction failures to safe 500', async () => {
    const f = fixture();
    f.query.getMany.mockResolvedValue([null]);
    await expect(f.service.list({ page: 1, limit: 25 })).rejects.toMatchObject({
      status: 500,
    });
  });
  it('keeps known business errors intact', async () => {
    const f = fixture();
    f.transaction.mockRejectedValue(
      new RegistrationError(
        409,
        'ADMIN_ACCOUNT_PROTECTED',
        'Administrator accounts cannot be changed',
      ),
    );
    await expect(
      f.service.update(principal, 'target', false),
    ).rejects.toMatchObject({ status: 409 });
  });
});
