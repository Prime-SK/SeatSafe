import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { DataSource } from 'typeorm';
import { Test } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types.js';
import request from 'supertest';
import configuredDatabase from '../dist/database/data-source.js';
import { WorkshopEntity } from '../dist/workshops/workshop.entity.js';
import { UserEntity } from '../dist/users/user.entity.js';
import { AuthSessionEntity } from '../dist/auth/auth-session.entity.js';
import { AuthRefreshTokenEntity } from '../dist/auth/auth-refresh-token.entity.js';
import { seedAdminAccount } from '../dist/database/seed-admin-account.js';

const schema = `seatsafe_test_${randomUUID().replaceAll('-', '')}`;
const hash = (value: string | Buffer) =>
  createHash('sha256').update(value).digest('hex');
describe('Workshop administration with real PostgreSQL', () => {
  let control: DataSource;
  let database: DataSource;
  let app: INestApplication<App>;
  let created = false;
  let token: string;
  let adminId: string;
  let beforeRows: string;
  let beforePrivate: string;
  const password = 'public isolated administrator password';
  const future = () => new Date(Date.now() + 86400000 * 7).toISOString();
  const input = () => ({
    title: '  New database workshop  ',
    capacity: 20,
    startsAt: future(),
  });
  async function rowFingerprint() {
    return hash(
      JSON.stringify(
        await Promise.all(
          ['users', 'auth_sessions', 'auth_refresh_tokens', 'workshops'].map(
            (table) =>
              control.query(`SELECT * FROM public."${table}" ORDER BY id`),
          ),
        ),
      ),
    );
  }
  async function privateFingerprint() {
    return hash(
      JSON.stringify(
        await Promise.all(
          ['../.env', '../../web/public/primeui-license.local.json'].map(
            async (path) =>
              hash(await readFile(new URL(path, import.meta.url))),
          ),
        ),
      ),
    );
  }
  beforeAll(async () => {
    const options = configuredDatabase.options;
    if (
      options.type !== 'postgres' ||
      options.database !== 'seatsafe_dev' ||
      !['development', 'test'].includes(process.env.NODE_ENV ?? '')
    )
      throw new Error('Tests require seatsafe_dev in development/test mode.');
    control = new DataSource({ ...options, migrations: [] });
    await control.initialize();
    beforeRows = await rowFingerprint();
    beforePrivate = await privateFingerprint();
    await control.query(`CREATE SCHEMA "${schema}"`);
    created = true;
    database = new DataSource({
      ...options,
      schema,
      logging: false,
      extra: { ...options.extra, application_name: schema },
    });
    await database.initialize();
    await database.runMigrations();
  });
  beforeEach(async () => {
    for (const entity of [
      AuthRefreshTokenEntity,
      AuthSessionEntity,
      UserEntity,
      WorkshopEntity,
    ])
      await database
        .getRepository(entity)
        .createQueryBuilder()
        .delete()
        .execute();
    const { AppModule } = await import('../dist/app.module.js');
    const { configureApp } = await import('../dist/app.setup.js');
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(getDataSourceToken())
      .useValue(database)
      .compile();
    app = module.createNestApplication();
    configureApp(app);
    await app.init();
    await seedAdminAccount(database, {
      displayName: 'Workshop administrator',
      email: 'admin@example.test',
      password,
    });
    adminId = (
      await database
        .getRepository(UserEntity)
        .findOneByOrFail({ email: 'admin@example.test' })
    ).id;
    token = (
      await request(app.getHttpServer())
        .post('/api/auth/login')
        .set('Origin', 'http://localhost:3000')
        .send({ email: 'admin@example.test', password })
        .expect(200)
    ).body.accessToken;
  });
  afterEach(async () => {
    await app?.close();
    if (!database.isInitialized) await database.initialize();
  });
  afterAll(async () => {
    try {
      if (database?.isInitialized) await database.destroy();
    } finally {
      if (control?.isInitialized) {
        try {
          if (created) await control.query(`DROP SCHEMA "${schema}" CASCADE`);
          expect(await rowFingerprint()).toBe(beforeRows);
          expect(await privateFingerprint()).toBe(beforePrivate);
        } finally {
          await control.destroy();
        }
      }
    }
  });
  const create = (body = input()) =>
    request(app.getHttpServer())
      .post('/api/admin/workshops')
      .set('Authorization', 'Bearer ' + token)
      .send(body);
  const patch = (body: Record<string, unknown>, id = 'legacy-workshop') =>
    request(app.getHttpServer())
      .patch('/api/admin/workshops/' + id)
      .set('Authorization', 'Bearer ' + token)
      .send(body);
  async function existing(overrides: Partial<WorkshopEntity> = {}) {
    return database.getRepository(WorkshopEntity).save({
      id: 'legacy-workshop',
      title: 'Existing workshop',
      capacity: 10,
      reservedSeats: 4,
      registrationOpen: false,
      startsAt: new Date(future()),
      ...overrides,
    });
  }
  async function waiting(count: number) {
    const deadline = Date.now() + 5000;
    do {
      const rows = await control.query(
        `SELECT count(*)::int AS count FROM pg_stat_activity WHERE application_name = $1 AND wait_event_type = 'Lock' AND query LIKE '%FOR UPDATE%'`,
        [schema],
      );
      if (rows[0].count >= count) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    } while (Date.now() < deadline);
    throw new Error('Expected workshop lock wait was not observed.');
  }
  it('persists creation and exposes exactly the same seven fields through public reads', async () => {
    const response = await create().expect(201);
    const id = response.body.id;
    expect(response.body).toMatchObject({
      title: 'New database workshop',
      capacity: 20,
      reservedSeats: 0,
      availableSeats: 20,
      registrationOpen: true,
    });
    expect(Object.keys(response.body)).toHaveLength(7);
    const stored = await database
      .getRepository(WorkshopEntity)
      .findOneByOrFail({ id });
    expect(stored.createdAt).toBeInstanceOf(Date);
    expect(
      (
        await request(app.getHttpServer())
          .get('/api/workshops/' + id)
          .expect(200)
      ).body,
    ).toEqual(response.body);
    expect(
      (await request(app.getHttpServer()).get('/api/workshops').expect(200))
        .body,
    ).toEqual([response.body]);
  });
  it('edits, closes and reopens without resetting reserved seats or omitted fields', async () => {
    const row = await existing();
    expect(
      (await patch({ title: 'Edited', capacity: 12 }).expect(200)).body,
    ).toMatchObject({
      title: 'Edited',
      capacity: 12,
      reservedSeats: 4,
      registrationOpen: false,
      startsAt: row.startsAt.toISOString(),
    });
    await patch({ registrationOpen: true }).expect(200);
    await patch({ registrationOpen: false }).expect(200);
    await patch({ registrationOpen: true }).expect(200);
    expect(
      (
        await database
          .getRepository(WorkshopEntity)
          .findOneByOrFail({ id: row.id })
      ).reservedSeats,
    ).toBe(4);
  });
  it('allows capacity equal to reservations and rolls back a lower capacity', async () => {
    await existing();
    await patch({ capacity: 4 }).expect(200);
    const before = await database.query(`SELECT * FROM "${schema}".workshops`);
    expect(
      (await patch({ capacity: 3, title: 'Must not persist' }).expect(409)).body
        .code,
    ).toBe('CAPACITY_BELOW_RESERVED');
    expect(await database.query(`SELECT * FROM "${schema}".workshops`)).toEqual(
      before,
    );
  });
  it('retains a historical date, allows closure and refuses reopening until rescheduled', async () => {
    const row = await existing({
      startsAt: new Date('2000-01-01T10:00:00Z'),
      registrationOpen: true,
    });
    await patch({
      title: 'Historical title',
      startsAt: row.startsAt.toISOString(),
    }).expect(200);
    await patch({ registrationOpen: false }).expect(200);
    await patch({ registrationOpen: true }).expect(409);
    await patch({ startsAt: future(), registrationOpen: true }).expect(200);
  });
  it('rejects past creation/rescheduling and preserves existing rows', async () => {
    await create({ ...input(), startsAt: '2000-01-01T10:00:00Z' }).expect(400);
    await existing();
    const before = await database.query(`SELECT * FROM "${schema}".workshops`);
    await patch({ startsAt: '2000-01-01T10:00:00Z' }).expect(400);
    expect(await database.query(`SELECT * FROM "${schema}".workshops`)).toEqual(
      before,
    );
  });
  it('returns a structured 404 for an unknown opaque ID', async () => {
    expect(
      (await patch({ title: 'Missing' }, 'unknown').expect(404)).body,
    ).toEqual({
      statusCode: 404,
      code: 'WORKSHOP_NOT_FOUND',
      message: 'Workshop not found',
    });
  });
  it('enforces the current role and account/session eligibility without workshop writes', async () => {
    await database.getRepository(UserEntity).update(adminId, { role: 'USER' });
    await create().expect(403);
    await database
      .getRepository(UserEntity)
      .update(adminId, { role: 'ADMIN', isEnabled: false });
    await create().expect(401);
    await database
      .getRepository(UserEntity)
      .update(adminId, { isEnabled: true });
    await database
      .getRepository(AuthSessionEntity)
      .update({ userId: adminId }, { revokedAt: new Date() });
    await create().expect(401);
    expect(await database.getRepository(WorkshopEntity).count()).toBe(0);
  });
  it.each(['INSERT', 'UPDATE'] as const)(
    'rolls back %s if PostgreSQL rejects commit',
    async (operation) => {
      if (operation === 'UPDATE') await existing();
      const before = await database.query(
        `SELECT * FROM "${schema}".workshops ORDER BY id`,
      );
      await database.query(
        `CREATE FUNCTION "${schema}".reject_workshop_commit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'private test database detail'; END $$`,
      );
      await database.query(
        `CREATE CONSTRAINT TRIGGER reject_workshop_commit AFTER ${operation} ON "${schema}".workshops DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "${schema}".reject_workshop_commit()`,
      );
      try {
        const response = await (
          operation === 'INSERT'
            ? create()
            : patch({ title: 'Rolled back', capacity: 12 })
        ).expect(503);
        expect(response.body).toEqual({
          statusCode: 503,
          code: 'DATABASE_UNAVAILABLE',
          message: 'Database unavailable',
        });
        expect(
          await database.query(
            `SELECT * FROM "${schema}".workshops ORDER BY id`,
          ),
        ).toEqual(before);
      } finally {
        await database.query(
          `DROP TRIGGER reject_workshop_commit ON "${schema}".workshops`,
        );
        await database.query(
          `DROP FUNCTION "${schema}".reject_workshop_commit()`,
        );
      }
    },
  );
  it('merges independent edits from two real queued requests', async () => {
    const row = await existing();
    const runner = database.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    let first: Promise<request.Response> | undefined;
    let second: Promise<request.Response> | undefined;
    try {
      await runner.manager
        .getRepository(WorkshopEntity)
        .createQueryBuilder('workshop')
        .setLock('pessimistic_write')
        .where('workshop.id = :id', { id: row.id })
        .getOne();
      first = patch({ title: 'First administrator title' }).then(
        (value) => value,
      );
      await waiting(1);
      second = patch({ capacity: 12 }).then((value) => value);
      await waiting(2);
      await runner.commitTransaction();
      expect((await first).status).toBe(200);
      expect((await second).status).toBe(200);
      expect(
        await database
          .getRepository(WorkshopEntity)
          .findOneByOrFail({ id: row.id }),
      ).toMatchObject({
        title: 'First administrator title',
        capacity: 12,
        reservedSeats: 4,
      });
    } finally {
      if (runner.isTransactionActive) await runner.rollbackTransaction();
      await runner.release();
      await Promise.allSettled(
        [first, second].filter((value) => value !== undefined),
      );
    }
  });
  it('applies the later queued edit when both administrators change the same field', async () => {
    const row = await existing();
    const runner = database.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    let first: Promise<request.Response> | undefined;
    let second: Promise<request.Response> | undefined;
    try {
      await runner.manager
        .getRepository(WorkshopEntity)
        .createQueryBuilder('workshop')
        .setLock('pessimistic_write')
        .where('workshop.id = :id', { id: row.id })
        .getOne();
      first = patch({ title: 'Earlier edit' }).then((value) => value);
      await waiting(1);
      second = patch({ title: 'Later edit' }).then((value) => value);
      await waiting(2);
      await runner.commitTransaction();
      await Promise.all([first, second]);
      expect(
        (
          await database
            .getRepository(WorkshopEntity)
            .findOneByOrFail({ id: row.id })
        ).title,
      ).toBe('Later edit');
    } finally {
      if (runner.isTransactionActive) await runner.rollbackTransaction();
      await runner.release();
      await Promise.allSettled(
        [first, second].filter((value) => value !== undefined),
      );
    }
  });
  it('rechecks reserved seats after a competing counter transaction commits', async () => {
    const row = await existing();
    const runner = database.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    let pending: Promise<request.Response> | undefined;
    try {
      await runner.manager
        .getRepository(WorkshopEntity)
        .update(row.id, { reservedSeats: 7 });
      pending = patch({ capacity: 6 }).then((value) => value);
      await waiting(1);
      await runner.commitTransaction();
      expect((await pending).status).toBe(409);
      expect(
        await database
          .getRepository(WorkshopEntity)
          .findOneByOrFail({ id: row.id }),
      ).toMatchObject({ capacity: 10, reservedSeats: 7 });
    } finally {
      if (runner.isTransactionActive) await runner.rollbackTransaction();
      await runner.release();
      await pending;
    }
  });
  it('preserves capacity when a guarded counter increment follows a capacity reduction', async () => {
    const row = await existing();
    const runner = database.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    let pending: Promise<request.Response> | undefined;
    let increment: Promise<unknown[]> | undefined;
    try {
      await runner.manager
        .getRepository(WorkshopEntity)
        .createQueryBuilder('workshop')
        .setLock('pessimistic_write')
        .where('workshop.id = :id', { id: row.id })
        .getOne();
      pending = patch({ capacity: 4 }).then((value) => value);
      await waiting(1);
      // Test-only counter operation, not a booking API or booking implementation.
      increment = database
        .query(
          `UPDATE "${schema}".workshops SET reserved_seats = reserved_seats + 1 WHERE id = $1 AND reserved_seats < capacity RETURNING id`,
          [row.id],
        )
        .then(([rows]: [unknown[], number]) => rows);
      await runner.commitTransaction();
      expect((await pending).status).toBe(200);
      expect(await increment).toEqual([]);
      expect(
        await database
          .getRepository(WorkshopEntity)
          .findOneByOrFail({ id: row.id }),
      ).toMatchObject({ capacity: 4, reservedSeats: 4 });
    } finally {
      if (runner.isTransactionActive) await runner.rollbackTransaction();
      await runner.release();
      await Promise.allSettled(
        [pending, increment].filter((value) => value !== undefined),
      );
    }
  });
});
