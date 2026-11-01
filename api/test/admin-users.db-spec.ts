import { createHash, randomBytes, randomUUID } from 'node:crypto';
import request from 'supertest';
import { vi } from 'vitest';
import { QueryFailedError, SelectQueryBuilder } from 'typeorm';
import { bookingFixture } from './support/booking-fixture.js';
import type { BookingFixture } from './support/booking-fixture.js';
import { UserEntity } from '../dist/users/user.entity.js';
import { AuthSessionEntity } from '../dist/auth/auth-session.entity.js';
import { AuthRefreshTokenEntity } from '../dist/auth/auth-refresh-token.entity.js';
import { WorkshopEntity } from '../dist/workshops/workshop.entity.js';
import { PasswordHasher } from '../dist/auth/password-hasher.js';
import { AdminUsersService } from '../dist/admin/admin-users.service.js';

describe('User administration with isolated PostgreSQL', () => {
  let f: BookingFixture;
  let admin: Awaited<ReturnType<BookingFixture['accounts']>>[number],
    user: typeof admin;
  beforeAll(async () => {
    f = await bookingFixture();
  });
  beforeEach(async () => {
    await f.reset();
    [admin] = await f.accounts(1, 'ADMIN');
    [user] = await f.accounts();
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    await f?.close();
  });
  const list = (suffix = '', token = admin.token) =>
    request(f.app.getHttpServer())
      .get('/api/admin/users' + suffix)
      .set('Authorization', 'Bearer ' + token);
  const status = (enabled: boolean, id = user.id, token = admin.token) =>
    request(f.app.getHttpServer())
      .patch('/api/admin/users/' + id + '/status')
      .set('Authorization', 'Bearer ' + token)
      .send({ isEnabled: enabled });
  const me = (token: string) =>
    request(f.app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', 'Bearer ' + token);
  const login = (email: string, password: string) =>
    request(f.app.getHttpServer())
      .post('/api/auth/login')
      .set('Origin', 'http://localhost:3000')
      .send({ email, password });
  const refresh = (cookie: string) =>
    request(f.app.getHttpServer())
      .post('/api/auth/refresh')
      .set('Origin', 'http://localhost:3000')
      .set('Cookie', cookie);
  const principal = () => ({
    id: admin.id,
    sessionId: admin.sessionId,
    displayName: 'Admin',
    email: 'admin@example.test',
    role: 'ADMIN' as const,
  });
  const sessionRows = () =>
    f.database.getRepository(AuthSessionEntity).find({ order: { id: 'ASC' } });
  async function historySnapshot() {
    return JSON.stringify(
      await Promise.all(
        [
          'bookings',
          'booking_idempotency_records',
          'workshops',
          'auth_refresh_tokens',
        ].map((t) =>
          f.database.query(`SELECT * FROM "${f.schema}"."${t}" ORDER BY id`),
        ),
      ),
    );
  }
  async function waiting(count = 1) {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const rows = await f.control.query(
        "SELECT count(*)::int AS count FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock'",
        [f.schema],
      );
      if (rows[0].count >= count) return;
    }
    throw Error('Expected bounded lock wait');
  }
  it('searches literal Unicode/name/email substrings and combines status with stable pagination', async () => {
    const [other] = await f.accounts();
    const users = f.database.getRepository(UserEntity);
    await users.update(user.id, {
      displayName: '雪 100%_! learner',
      createdAt: new Date(1000),
    });
    await users.update(other.id, {
      displayName: '雪 plain learner',
      isEnabled: false,
      createdAt: new Date(2000),
    });
    const before = JSON.stringify(await users.find({ order: { id: 'ASC' } }));
    const literal = await list('?search=' + encodeURIComponent('%_!')).expect(
      200,
    );
    expect(literal.body.total).toBe(1);
    expect(literal.body.items[0].id).toBe(user.id);
    expect(Object.keys(literal.body.items[0]).sort()).toEqual([
      'displayName',
      'email',
      'id',
      'isEnabled',
      'role',
    ]);
    const combined = await list(
      '?search=' + encodeURIComponent(' 雪 ') + '&status=disabled',
    ).expect(200);
    expect(combined.body.items.map((r: { id: string }) => r.id)).toEqual([
      other.id,
    ]);
    expect(
      (
        await list(
          '?search=' + encodeURIComponent(other.id.toUpperCase()),
        ).expect(200)
      ).body.total,
    ).toBe(1);
    expect((await list('?limit=1&page=2').expect(200)).body.items[0].id).toBe(
      other.id,
    );
    expect((await list('?page=100').expect(200)).body).toMatchObject({
      items: [],
      total: 3,
      page: 100,
      limit: 25,
    });
    expect((await list('?search=no-match').expect(200)).body.total).toBe(0);
    expect(JSON.stringify(await users.find({ order: { id: 'ASC' } }))).toBe(
      before,
    );
  });
  it('keeps count and page in one read-only repeatable snapshot during a concurrent insertion', async () => {
    // oxlint-disable-next-line typescript/unbound-method -- Explicitly rebound to the query under test below.
    const original = SelectQueryBuilder.prototype.getCount;
    vi.spyOn(SelectQueryBuilder.prototype, 'getCount').mockImplementationOnce(
      async function (this: SelectQueryBuilder<UserEntity>) {
        const count = await original.call(this);
        await f.accounts();
        return count;
      },
    );
    const result = await f.app
      .get(AdminUsersService)
      .list({ page: 1, limit: 25 });
    expect(result.total).toBe(2);
    expect(result.items).toHaveLength(2);
    expect(await f.database.getRepository(UserEntity).count()).toBe(3);
  });
  it('disables all sessions once while preserving bookings, keys, counters, credentials and unrelated accounts', async () => {
    await f.workshop();
    await f.reserve(user.token).expect(201);
    await f.database.getRepository(AuthSessionEntity).insert([
      {
        id: randomUUID(),
        userId: user.id,
        expiresAt: new Date(0),
        revokedAt: null,
      },
      {
        id: randomUUID(),
        userId: user.id,
        expiresAt: new Date(0),
        revokedAt: new Date(1234),
      },
    ]);
    const history = await historySnapshot();
    const actor = await f.database
      .getRepository(UserEntity)
      .findOneByOrFail({ id: admin.id });
    const result = await status(false).expect(200);
    expect(result.body).toMatchObject({
      id: user.id,
      isEnabled: false,
      role: 'USER',
    });
    const sessions = await sessionRows();
    expect(
      sessions
        .filter((s) => s.userId === user.id)
        .every((s) => s.revokedAt !== null),
    ).toBe(true);
    expect(sessions.some((s) => s.revokedAt?.getTime() === 1234)).toBe(true);
    const unchanged = JSON.stringify([
      await f.database
        .getRepository(UserEntity)
        .findOneByOrFail({ id: user.id }),
      sessions,
    ]);
    await status(false).expect(200);
    expect(
      JSON.stringify([
        await f.database
          .getRepository(UserEntity)
          .findOneByOrFail({ id: user.id }),
        await sessionRows(),
      ]),
    ).toBe(unchanged);
    expect(await historySnapshot()).toBe(history);
    expect(
      await f.database
        .getRepository(UserEntity)
        .findOneByOrFail({ id: admin.id }),
    ).toEqual(actor);
    await me(user.token).expect(401);
    await f.reserve(user.token).expect(401);
    await f.mine(user.token).expect(401);
  });
  it('requires fresh login after enabling; old access and refresh credentials stay rejected', async () => {
    const password = 'public user status fixture password';
    const users = f.database.getRepository(UserEntity);
    await users.update(user.id, {
      passwordHash: await f.app.get(PasswordHasher).hash(password),
    });
    const row = await users.findOneByOrFail({ id: user.id });
    const first = await login(row.email, password).expect(200),
      second = await login(row.email, password).expect(200);
    const cookie = (r: request.Response) =>
      String(r.headers['set-cookie'][0]).split(';')[0]!;
    await status(false).expect(200);
    await me(first.body.accessToken).expect(401);
    await refresh(cookie(first)).expect(401);
    await status(true).expect(200);
    await me(second.body.accessToken).expect(401);
    await refresh(cookie(second)).expect(401);
    const before = await sessionRows();
    await status(true).expect(200);
    expect(await sessionRows()).toEqual(before);
    const fresh = await login(row.email, password).expect(200);
    await me(fresh.body.accessToken).expect(200);
    expect(await f.database.getRepository(AuthRefreshTokenEntity).count()).toBe(
      3,
    );
  });
  it('protects self and other ADMIN accounts in both states and rejects unknown UUIDs', async () => {
    const [other] = await f.accounts(1, 'ADMIN');
    await f.database
      .getRepository(UserEntity)
      .update(other.id, { isEnabled: false });
    const before = await sessionRows();
    for (const id of [admin.id, other.id])
      for (const enabled of [true, false])
        expect((await status(enabled, id).expect(409)).body.code).toBe(
          'ADMIN_ACCOUNT_PROTECTED',
        );
    await status(false, randomUUID()).expect(404);
    expect(await sessionRows()).toEqual(before);
    await list('', user.token).expect(403);
    await status(false, user.id, user.token).expect(403);
  });
  it('two administrators targeting each other fail safely without mutual lock deadlock', async () => {
    const [other] = await f.accounts(1, 'ADMIN');
    const results = await Promise.all([
      status(false, other.id).timeout({ deadline: 5000 }),
      status(false, admin.id, other.token).timeout({ deadline: 5000 }),
    ]);
    expect(results.map((r) => r.status)).toEqual([409, 409]);
  });
  it.each(['account', 'sessions', 'commit'] as const)(
    'rolls back %s failures with safe 503 and no partial state',
    async (stage) => {
      const before = JSON.stringify([
        await f.database
          .getRepository(UserEntity)
          .find({ order: { id: 'ASC' } }),
        await sessionRows(),
      ]);
      const make = f.database.createQueryRunner.bind(f.database),
        runner = make();
      await runner.connect();
      const fail = () => {
        throw new QueryFailedError(
          'private fixture SQL',
          [],
          Object.assign(Error('private driver detail'), { code: '08006' }),
        );
      };
      if (stage === 'commit')
        vi.spyOn(runner, 'commitTransaction').mockImplementationOnce(fail);
      else {
        const query = runner.query.bind(runner);
        vi.spyOn(runner, 'query').mockImplementation(
          async (...args: Parameters<typeof runner.query>) => {
            if (
              args[0].startsWith('UPDATE') &&
              args[0].includes(
                stage === 'account' ? '."users"' : '."auth_sessions"',
              )
            )
              fail();
            return query(...args);
          },
        );
      }
      const replace = vi
        .spyOn(f.database, 'createQueryRunner')
        .mockReturnValueOnce(runner);
      try {
        await expect(
          f.app.get(AdminUsersService).update(principal(), user.id, false),
        ).rejects.toMatchObject({ status: 503 });
      } finally {
        replace.mockRestore();
        vi.restoreAllMocks();
        if (!runner.isReleased) await runner.release();
      }
      expect(
        JSON.stringify([
          await f.database
            .getRepository(UserEntity)
            .find({ order: { id: 'ASC' } }),
          await sessionRows(),
        ]),
      ).toBe(before);
    },
  );
  it.each(['disabled', 'role', 'revoked', 'expired'] as const)(
    'rechecks actor %s after acquiring its lock',
    async (change) => {
      const runner = f.database.createQueryRunner();
      await runner.connect();
      await runner.startTransaction();
      let pending: Promise<request.Response> | undefined;
      try {
        await runner.manager.getRepository(UserEntity).findOne({
          where: { id: admin.id },
          lock: { mode: 'pessimistic_write' },
        });
        pending = status(false).then((r) => r);
        await waiting();
        if (change === 'disabled' || change === 'role')
          await runner.manager
            .getRepository(UserEntity)
            .update(
              admin.id,
              change === 'disabled' ? { isEnabled: false } : { role: 'USER' },
            );
        else
          await runner.manager
            .getRepository(AuthSessionEntity)
            .update(
              admin.sessionId,
              change === 'revoked'
                ? { revokedAt: new Date() }
                : { expiresAt: new Date(0) },
            );
        await runner.commitTransaction();
        expect((await pending).status).toBe(change === 'role' ? 403 : 401);
        expect(
          (
            await f.database
              .getRepository(UserEntity)
              .findOneByOrFail({ id: user.id })
          ).isEnabled,
        ).toBe(true);
      } finally {
        if (runner.isTransactionActive) await runner.rollbackTransaction();
        await runner.release();
        await pending;
      }
    },
  );
  it('rechecks session expiry after waiting for the target lock', async () => {
    const expires = new Date(Date.now() + 1500);
    await f.database
      .getRepository(AuthSessionEntity)
      .update(admin.sessionId, { expiresAt: expires });
    const runner = f.database.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    let pending: Promise<request.Response> | undefined;
    try {
      await runner.manager.getRepository(UserEntity).findOne({
        where: { id: user.id },
        lock: { mode: 'pessimistic_write' },
      });
      pending = status(false).then((r) => r);
      await waiting();
      await runner.query(
        'SELECT pg_sleep(GREATEST(0, EXTRACT(EPOCH FROM ($1::timestamptz - clock_timestamp()))) + 0.05)',
        [expires],
      );
      await runner.commitTransaction();
      expect((await pending).status).toBe(401);
    } finally {
      if (runner.isTransactionActive) await runner.rollbackTransaction();
      await runner.release();
      await pending;
    }
  });
  it('serializes concurrent status changes with the target user lock', async () => {
    const [other] = await f.accounts(1, 'ADMIN');
    const runner = f.database.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    const work: Promise<request.Response>[] = [];
    try {
      await runner.manager.getRepository(UserEntity).findOne({
        where: { id: user.id },
        lock: { mode: 'pessimistic_write' },
      });
      work.push(status(false).then((r) => r));
      await waiting(1);
      work.push(status(true, user.id, other.token).then((r) => r));
      await waiting(2);
      await runner.commitTransaction();
      expect((await Promise.all(work)).map((r) => r.status)).toEqual([
        200, 200,
      ]);
      expect(
        (
          await f.database
            .getRepository(UserEntity)
            .findOneByOrFail({ id: user.id })
        ).isEnabled,
      ).toBe(true);
      await me(user.token).expect(401);
    } finally {
      if (runner.isTransactionActive) await runner.rollbackTransaction();
      await runner.release();
      await Promise.allSettled(work);
    }
  });
  it.each(['disable-first', 'reserve-first'] as const)(
    'serializes reservation competition: %s',
    async (order) => {
      await f.workshop();
      const runner = f.database.createQueryRunner();
      await runner.connect();
      await runner.startTransaction();
      const work: Promise<request.Response>[] = [];
      try {
        await runner.manager.getRepository(UserEntity).findOne({
          where: { id: user.id },
          lock: { mode: 'pessimistic_write' },
        });
        const disable = () => status(false).then((r) => r),
          reserve = () => f.reserve(user.token).then((r) => r);
        work.push(order === 'disable-first' ? disable() : reserve());
        await waiting(1);
        work.push(order === 'disable-first' ? reserve() : disable());
        await waiting(2);
        await runner.commitTransaction();
        const results = await Promise.all(work);
        expect(results.map((r) => r.status)).toEqual(
          order === 'disable-first' ? [200, 401] : [201, 200],
        );
        expect(
          (
            await f.database
              .getRepository(WorkshopEntity)
              .findOneByOrFail({ id: 'legacy-workshop' })
          ).reservedSeats,
        ).toBe(order === 'disable-first' ? 0 : 1);
      } finally {
        if (runner.isTransactionActive) await runner.rollbackTransaction();
        await runner.release();
        await Promise.allSettled(work);
      }
    },
  );
  it.each(['login-first', 'disable-first'] as const)(
    'serializes login competition: %s',
    async (order) => {
      const password = 'public login race fixture password';
      await f.database.getRepository(UserEntity).update(user.id, {
        passwordHash: await f.app.get(PasswordHasher).hash(password),
      });
      const row = await f.database
        .getRepository(UserEntity)
        .findOneByOrFail({ id: user.id });
      const runner = f.database.createQueryRunner();
      await runner.connect();
      await runner.startTransaction();
      const work: Promise<request.Response>[] = [];
      try {
        await runner.manager.getRepository(UserEntity).findOne({
          where: { id: user.id },
          lock: { mode: 'pessimistic_write' },
        });
        const doLogin = () => login(row.email, password).then((r) => r);
        const doDisable = () => status(false).then((r) => r);
        work.push(order === 'login-first' ? doLogin() : doDisable());
        await waiting(1);
        work.push(order === 'login-first' ? doDisable() : doLogin());
        await waiting(2);
        await runner.commitTransaction();
        const results = await Promise.all(work);
        expect(results.map((r) => r.status)).toEqual(
          order === 'login-first' ? [200, 200] : [200, 401],
        );
        if (order === 'login-first')
          await me(results[0]!.body.accessToken).expect(401);
      } finally {
        if (runner.isTransactionActive) await runner.rollbackTransaction();
        await runner.release();
        await Promise.allSettled(work);
      }
    },
  );
  it.each(['refresh-first', 'disable-first'] as const)(
    'serializes refresh competition: %s',
    async (order) => {
      const raw = randomBytes(32).toString('base64url');
      await f.database.getRepository(AuthRefreshTokenEntity).insert({
        id: randomUUID(),
        sessionId: user.sessionId,
        tokenHash: createHash('sha256').update(raw).digest('hex'),
        consumedAt: null,
      });
      const runner = f.database.createQueryRunner();
      await runner.connect();
      await runner.startTransaction();
      const work: Promise<request.Response>[] = [];
      try {
        await runner.manager.getRepository(UserEntity).findOne({
          where: { id: user.id },
          lock: { mode: 'pessimistic_write' },
        });
        const rotate = () => refresh('seatsafe_refresh=' + raw).then((r) => r),
          disable = () => status(false).then((r) => r);
        work.push(order === 'refresh-first' ? rotate() : disable());
        await waiting(1);
        work.push(order === 'refresh-first' ? disable() : rotate());
        await waiting(2);
        await runner.commitTransaction();
        const results = await Promise.all(work);
        expect(results.map((r) => r.status)).toEqual(
          order === 'refresh-first' ? [200, 200] : [200, 401],
        );
        if (order === 'refresh-first')
          await me(results[0]!.body.accessToken).expect(401);
        expect(
          (
            await f.database
              .getRepository(AuthSessionEntity)
              .findOneByOrFail({ id: user.sessionId })
          ).revokedAt,
        ).not.toBeNull();
      } finally {
        if (runner.isTransactionActive) await runner.rollbackTransaction();
        await runner.release();
        await Promise.allSettled(work);
      }
    },
  );
  it('protects a target promoted to ADMIN while the request waits for its lock', async () => {
    const runner = f.database.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    let pending: Promise<request.Response> | undefined;
    try {
      await runner.manager.getRepository(UserEntity).findOne({
        where: { id: user.id },
        lock: { mode: 'pessimistic_write' },
      });
      pending = status(false).then((r) => r);
      await waiting();
      await runner.manager
        .getRepository(UserEntity)
        .update(user.id, { role: 'ADMIN' });
      await runner.commitTransaction();
      expect((await pending).body.code).toBe('ADMIN_ACCOUNT_PROTECTED');
    } finally {
      if (runner.isTransactionActive) await runner.rollbackTransaction();
      await runner.release();
      await pending;
    }
  });
});
