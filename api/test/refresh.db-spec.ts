import { randomUUID, createHash } from 'node:crypto';
import { RefreshTokenService } from '../dist/auth/refresh-token.service.js';
import { DataSource } from 'typeorm';
import { Test } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types.js';
import request from 'supertest';
import { vi } from 'vitest';
import configuredDatabase from '../dist/database/data-source.js';
import { UserEntity } from '../dist/users/user.entity.js';
import { AuthRefreshTokenEntity } from '../dist/auth/auth-refresh-token.entity.js';
import { AuthSessionEntity } from '../dist/auth/auth-session.entity.js';
import { AccessTokenService } from '../dist/auth/access-token.service.js';

const schema = `seatsafe_test_${randomUUID().replaceAll('-', '')}`;
describe('Refresh credentials with real PostgreSQL', () => {
  let control: DataSource;
  let database: DataSource;
  let app: INestApplication<App>;
  let created = false;
  let _userId: string;
  const password = ' 🔐 Unicode unchanged password ';
  beforeAll(async () => {
    const options = configuredDatabase.options;
    if (
      options.type !== 'postgres' ||
      options.database !== 'seatsafe_dev' ||
      !['development', 'test'].includes(process.env.NODE_ENV ?? '')
    )
      throw new Error(
        'Tests require seatsafe_dev and development/test environment.',
      );
    control = new DataSource({ ...options, migrations: [] });
    await control.initialize();
    await control.query(`CREATE SCHEMA "${schema}"`);
    created = true;
    database = new DataSource({ ...options, schema, logging: false });
    await database.initialize();
    await database.runMigrations();
  });
  beforeEach(async () => {
    await database
      .getRepository(AuthRefreshTokenEntity)
      .createQueryBuilder()
      .delete()
      .execute();
    await database
      .getRepository(AuthSessionEntity)
      .createQueryBuilder()
      .delete()
      .execute();
    await database
      .getRepository(UserEntity)
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
    _userId = (
      await request(app.getHttpServer())
        .post('/api/auth/register')
        .send({
          displayName: 'Session learner',
          email: 'learner@example.test',
          password,
        })
        .expect(201)
    ).body.id;
  });
  afterEach(async () => {
    vi.restoreAllMocks();
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
        } finally {
          await control.destroy();
        }
      }
    }
  });
  const login = () =>
    request(app.getHttpServer())
      .post('/api/auth/login')
      .set('Origin', 'http://localhost:3000')
      .send({ email: 'learner@example.test', password });
  const records = () => database.getRepository(AuthRefreshTokenEntity);
  it('stores only the hash linked to a fixed seven-day session and preserves read-only me', async () => {
    const result = await login().expect(200);
    const raw = result.headers['set-cookie'][0].match(
      /^seatsafe_refresh=([^;]+)/,
    )![1];
    const stored = await records()
      .createQueryBuilder('refresh')
      .addSelect('refresh.tokenHash')
      .getOneOrFail();
    expect(stored.tokenHash).toBe(
      createHash('sha256').update(raw).digest('hex'),
    );
    expect(stored.consumedAt).toBeNull();
    expect(
      (await records().findOneByOrFail({ id: stored.id })).tokenHash,
    ).toBeUndefined();
    const session = await database
      .getRepository(AuthSessionEntity)
      .findOneByOrFail({ id: stored.sessionId });
    expect(session.expiresAt.getTime() - session.createdAt.getTime()).toBe(
      604800000,
    );
    const snapshot = async () =>
      JSON.stringify(
        await database.query(
          `SELECT * FROM "${schema}".auth_refresh_tokens ORDER BY id`,
        ),
      );
    const before = await snapshot();
    await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', 'Bearer ' + result.body.accessToken)
      .expect(200);
    expect(await snapshot()).toBe(before);
    expect(JSON.stringify(stored)).not.toContain(raw);
  });
  it('creates independent simultaneous credentials without revoking another session', async () => {
    const results = await Promise.all([
      login().expect(200),
      login().expect(200),
    ]);
    expect(results[0].headers['set-cookie'][0]).not.toBe(
      results[1].headers['set-cookie'][0],
    );
    expect(await records().count()).toBe(2);
    expect(await database.getRepository(AuthSessionEntity).count()).toBe(2);
    for (const result of results)
      await request(app.getHttpServer())
        .get('/api/auth/me')
        .set('Authorization', 'Bearer ' + result.body.accessToken)
        .expect(200);
  });
  it.each(['generation', 'insert', 'signing', 'commit'])(
    'rolls back both records on %s failure and permits retry',
    async (kind) => {
      if (kind === 'generation')
        vi.spyOn(
          app.get(RefreshTokenService),
          'generate',
        ).mockImplementationOnce(() => {
          throw new Error('private');
        });
      if (kind === 'signing')
        vi.spyOn(app.get(AccessTokenService), 'sign').mockRejectedValueOnce(
          new Error('private'),
        );
      if (kind === 'insert') {
        await database.query(
          `CREATE FUNCTION "${schema}".reject_refresh() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'private insert failure'; END $$`,
        );
        await database.query(
          `CREATE TRIGGER reject_refresh BEFORE INSERT ON "${schema}".auth_refresh_tokens FOR EACH ROW EXECUTE FUNCTION "${schema}".reject_refresh()`,
        );
      }
      if (kind === 'commit') {
        await database.query(
          `CREATE FUNCTION "${schema}".reject_commit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'private commit failure'; END $$`,
        );
        await database.query(
          `CREATE CONSTRAINT TRIGGER reject_commit AFTER INSERT ON "${schema}".auth_refresh_tokens DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "${schema}".reject_commit()`,
        );
      }
      const response = await login().expect(
        kind === 'generation' || kind === 'signing' ? 500 : 503,
      );
      expect(response.headers['set-cookie']).toBeUndefined();
      expect(await records().count()).toBe(0);
      expect(await database.getRepository(AuthSessionEntity).count()).toBe(0);
      vi.restoreAllMocks();
      if (kind === 'insert')
        await database.query(
          `DROP TRIGGER reject_refresh ON "${schema}".auth_refresh_tokens`,
        );
      if (kind === 'commit')
        await database.query(
          `DROP TRIGGER reject_commit ON "${schema}".auth_refresh_tokens`,
        );
      await login().expect(200);
      expect(await records().count()).toBe(1);
    },
  );
  it('enforces hash format, uniqueness, one unconsumed credential and session foreign keys', async () => {
    await login().expect(200);
    const stored = await records()
      .createQueryBuilder('refresh')
      .addSelect('refresh.tokenHash')
      .getOneOrFail();
    await expect(
      records().insert({
        id: randomUUID(),
        sessionId: randomUUID(),
        tokenHash: 'a'.repeat(64),
      }),
    ).rejects.toMatchObject({ driverError: { code: '23503' } });
    await expect(
      records().insert({
        id: randomUUID(),
        sessionId: stored.sessionId,
        tokenHash: 'invalid',
      }),
    ).rejects.toMatchObject({ driverError: { code: '23514' } });
    await expect(
      records().insert({
        id: randomUUID(),
        sessionId: stored.sessionId,
        tokenHash: 'b'.repeat(64),
      }),
    ).rejects.toMatchObject({ driverError: { code: '23505' } });
    await records().update(stored.id, { consumedAt: new Date() });
    await expect(
      records().insert({
        id: randomUUID(),
        sessionId: stored.sessionId,
        tokenHash: stored.tokenHash,
      }),
    ).rejects.toMatchObject({ driverError: { code: '23505' } });
    await records().insert({
      id: randomUUID(),
      sessionId: stored.sessionId,
      tokenHash: 'b'.repeat(64),
    });
    await expect(
      database.getRepository(AuthSessionEntity).delete(stored.sessionId),
    ).rejects.toMatchObject({ driverError: { code: '23503' } });
    expect(await records().count()).toBe(2);
  });
  it('reverses/reapplies the additive migration without changing existing sessions or backfilling credentials', async () => {
    await login().expect(200);
    const before = await database.getRepository(AuthSessionEntity).find();
    await database.undoLastMigration();
    expect(await database.getRepository(AuthSessionEntity).find()).toEqual(
      before,
    );
    expect(await database.runMigrations()).toHaveLength(1);
    expect(await records().count()).toBe(0);
    expect(await database.getRepository(AuthSessionEntity).find()).toEqual(
      before,
    );
    expect(
      (await database.driver.createSchemaBuilder().log()).upQueries,
    ).toEqual([]);
    expect(
      await database.query(`SELECT * FROM "${schema}".migrations`),
    ).toHaveLength(4);
  });
});
