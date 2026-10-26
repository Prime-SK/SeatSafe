import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { Test } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types.js';
import request from 'supertest';
import { JwtService } from '@nestjs/jwt';
import { vi } from 'vitest';
import configuredDatabase from '../dist/database/data-source.js';
import { UserEntity } from '../dist/users/user.entity.js';
import { AuthRefreshTokenEntity } from '../dist/auth/auth-refresh-token.entity.js';
import { AuthSessionEntity } from '../dist/auth/auth-session.entity.js';
import { AccessTokenService } from '../dist/auth/access-token.service.js';
import { PasswordHasher } from '../dist/auth/password-hasher.js';

const schema = `seatsafe_test_${randomUUID().replaceAll('-', '')}`;
describe('Login sessions with real PostgreSQL', () => {
  let control: DataSource;
  let database: DataSource;
  let app: INestApplication<App>;
  let created = false;
  let userId: string;
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
    userId = (
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
  const login = (input = { email: ' Learner@Example.test ', password }) =>
    request(app.getHttpServer())
      .post('/api/auth/login')
      .set('Origin', 'http://localhost:3000')
      .send(input);
  it('creates a linked seven-day session and returns a verified 15-minute token', async () => {
    const result = await login().expect(200);
    const claims = app
      .get(JwtService)
      .verify(result.body.accessToken, { algorithms: ['HS256'] });
    expect(Object.keys(claims).sort()).toEqual(['exp', 'iat', 'sid', 'sub']);
    expect(claims.exp - claims.iat).toBe(900);
    expect(claims.sub).toBe(userId);
    const session = await database
      .getRepository(AuthSessionEntity)
      .findOneByOrFail({ id: claims.sid });
    expect(session.userId).toBe(userId);
    expect(session.expiresAt.getTime() - session.createdAt.getTime()).toBe(
      604800000,
    );
    expect(session.revokedAt).toBeNull();
    expect(Object.keys(result.body.user).sort()).toEqual([
      'displayName',
      'email',
      'id',
      'role',
    ]);
    expect(result.headers['set-cookie'][0]).toContain('seatsafe_refresh=');
    expect(result.headers['cache-control']).toBe('no-store');
  });
  it('keeps independent concurrent logins and their distinct session identifiers', async () => {
    const results = await Promise.all([
      login().expect(200),
      login().expect(200),
    ]);
    const identifiers = results.map(
      (result) => app.get(JwtService).verify(result.body.accessToken).sid,
    );
    expect(new Set(identifiers).size).toBe(2);
    expect(await database.getRepository(AuthSessionEntity).count()).toBe(2);
  });
  it.each(['wrong', 'unknown', 'disabled'])(
    'rejects %s credentials without a session',
    async (kind) => {
      if (kind === 'disabled')
        await database
          .getRepository(UserEntity)
          .update(userId, { isEnabled: false });
      const input = {
        email:
          kind === 'unknown' ? 'absent@example.test' : 'learner@example.test',
        password: kind === 'wrong' ? password.trim() : password,
      };
      expect((await login(input).expect(401)).body).toEqual({
        statusCode: 401,
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid email or password',
      });
      expect(await database.getRepository(AuthSessionEntity).count()).toBe(0);
    },
  );
  it('returns the current ADMIN profile without putting role into JWT claims', async () => {
    await database.getRepository(UserEntity).update(userId, { role: 'ADMIN' });
    const response = await login().expect(200);
    expect(response.body.user.role).toBe('ADMIN');
    expect(
      app.get(JwtService).verify(response.body.accessToken).role,
    ).toBeUndefined();
  });
  it('rolls back a session when signing fails and allows retry', async () => {
    const signer = vi
      .spyOn(app.get(AccessTokenService), 'sign')
      .mockRejectedValueOnce(new Error('private signing failure'));
    expect((await login().expect(500)).body.code).toBe('INTERNAL_ERROR');
    expect(await database.getRepository(AuthSessionEntity).count()).toBe(0);
    signer.mockRestore();
    await login().expect(200);
    expect(await database.getRepository(AuthSessionEntity).count()).toBe(1);
  });
  it('rejects an account disabled after verification but before the locked recheck', async () => {
    const hasher = app.get(PasswordHasher);
    const verify = hasher.verify.bind(hasher);
    vi.spyOn(hasher, 'verify').mockImplementationOnce(
      async (hash, supplied) => {
        const valid = await verify(hash, supplied);
        await database
          .getRepository(UserEntity)
          .update(userId, { isEnabled: false });
        return valid;
      },
    );
    await login().expect(401);
    expect(await database.getRepository(AuthSessionEntity).count()).toBe(0);
  });
  it('enforces the user foreign key and restrictive user deletion', async () => {
    await expect(
      database.getRepository(AuthSessionEntity).insert({
        id: randomUUID(),
        userId: randomUUID(),
        expiresAt: new Date(Date.now() + 604800000),
      }),
    ).rejects.toMatchObject({ driverError: { code: '23503' } });
    await login().expect(200);
    await expect(
      database.getRepository(UserEntity).delete(userId),
    ).rejects.toMatchObject({ driverError: { code: '23503' } });
  });
  it('matches entity metadata, migration history and session table constraints', async () => {
    expect(
      (await database.driver.createSchemaBuilder().log()).upQueries,
    ).toEqual([]);
    const history = await database.query(
      `SELECT name FROM "${schema}".migrations ORDER BY id`,
    );
    expect(history.map((row: { name: string }) => row.name)).toEqual([
      'CreateWorkshops1791590400000',
      'CreateUsers1791676800000',
      'CreateAuthSessions1791763200000',
      'CreateAuthRefreshTokens1792972800000',
    ]);
    const runner = database.createQueryRunner();
    try {
      const table = await runner.getTable(`${schema}.auth_sessions`);
      expect(table?.foreignKeys[0].referencedSchema).toBe(schema);
      expect(table?.foreignKeys[0].name).toBe('FK_auth_sessions_user');
      expect(table?.indices.map((index) => index.name)).toContain(
        'IDX_auth_sessions_user_id',
      );
    } finally {
      await runner.release();
    }
  });
  it('reverses and reapplies only sessions while keeping the account and workshop tables', async () => {
    await login().expect(200);
    await database.undoLastMigration();
    await database.undoLastMigration();
    expect(
      (
        await database.query('SELECT to_regclass($1) AS name', [
          `${schema}.auth_sessions`,
        ])
      )[0].name,
    ).toBeNull();
    expect(await database.getRepository(UserEntity).count()).toBe(1);
    expect(
      (
        await database.query('SELECT to_regclass($1) AS name', [
          `${schema}.workshops`,
        ])
      )[0].name,
    ).not.toBeNull();
    expect(await database.runMigrations()).toHaveLength(2);
  });
});
