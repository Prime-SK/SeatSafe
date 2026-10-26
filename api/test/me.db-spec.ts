import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { Test } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types.js';
import request from 'supertest';
import { JwtService } from '@nestjs/jwt';
import configuredDatabase from '../dist/database/data-source.js';
import { UserEntity } from '../dist/users/user.entity.js';
import { AuthRefreshTokenEntity } from '../dist/auth/auth-refresh-token.entity.js';
import { AuthSessionEntity } from '../dist/auth/auth-session.entity.js';

const schema = `seatsafe_test_${randomUUID().replaceAll('-', '')}`;
describe('Protected account with real PostgreSQL', () => {
  let control: DataSource;
  let database: DataSource;
  let app: INestApplication<App>;
  let created = false;
  let userId: string;
  let accessToken: string;
  let sessionId: string;
  const password = 'unchanged database test password';
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
          displayName: 'Protected learner',
          email: 'protected@example.test',
          password,
        })
        .expect(201)
    ).body.id;
    accessToken = (
      await request(app.getHttpServer())
        .post('/api/auth/login')
        .set('Origin', 'http://localhost:3000')
        .send({ email: 'protected@example.test', password })
        .expect(200)
    ).body.accessToken;
    sessionId = app.get(JwtService).verify(accessToken).sid;
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
        } finally {
          await control.destroy();
        }
      }
    }
  });
  const me = (token = accessToken) =>
    request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', 'Bearer ' + token);
  it('returns four safe fields without writes, session renewal or hash selection', async () => {
    const before = await database.query(
      `SELECT * FROM "${schema}".auth_sessions ORDER BY id`,
    );
    const usersBefore = await database.query(
      `SELECT * FROM "${schema}".users ORDER BY id`,
    );
    const result = await me().expect(200);
    expect(result.body).toEqual({
      id: userId,
      displayName: 'Protected learner',
      email: 'protected@example.test',
      role: 'USER',
    });
    expect(result.headers['cache-control']).toBe('no-store');
    expect(result.headers['set-cookie']).toBeUndefined();
    expect(
      await database.query(
        `SELECT * FROM "${schema}".auth_sessions ORDER BY id`,
      ),
    ).toEqual(before);
    expect(
      await database.query(`SELECT * FROM "${schema}".users ORDER BY id`),
    ).toEqual(usersBefore);
    const joined = await database
      .getRepository(AuthSessionEntity)
      .createQueryBuilder('session')
      .innerJoinAndSelect('session.user', 'user')
      .getOne();
    expect(joined!.user.passwordHash).toBeUndefined();
  });
  it('reads current profile and role after token issuance', async () => {
    await database.getRepository(UserEntity).update(userId, {
      displayName: 'Updated learner',
      email: 'updated@example.test',
      role: 'ADMIN',
    });
    expect((await me().expect(200)).body).toEqual({
      id: userId,
      displayName: 'Updated learner',
      email: 'updated@example.test',
      role: 'ADMIN',
    });
  });
  it.each([
    'disabled',
    'revoked',
    'expired',
    'missing session',
    'missing account',
  ])('rejects %s after token issuance', async (kind) => {
    if (kind === 'disabled')
      await database
        .getRepository(UserEntity)
        .update(userId, { isEnabled: false });
    if (kind === 'revoked')
      await database
        .getRepository(AuthSessionEntity)
        .update(sessionId, { revokedAt: new Date() });
    if (kind === 'expired')
      await database
        .getRepository(AuthSessionEntity)
        .update(sessionId, { expiresAt: new Date(0) });
    if (kind === 'missing session' || kind === 'missing account') {
      await database
        .getRepository(AuthRefreshTokenEntity)
        .delete({ sessionId });
      await database.getRepository(AuthSessionEntity).delete(sessionId);
    }
    if (kind === 'missing account')
      await database.getRepository(UserEntity).delete(userId);
    const result = await me().expect(401);
    expect(result.body).toEqual({
      statusCode: 401,
      code: 'UNAUTHORIZED',
      message: 'Authentication required',
    });
    expect(result.headers['www-authenticate']).toBe('Bearer');
    expect(result.headers['cache-control']).toBe('no-store');
  });
  it('rejects a correctly signed token with mismatched user and session identifiers', async () => {
    const wrong = app
      .get(JwtService)
      .sign(
        { sub: randomUUID(), sid: sessionId },
        { algorithm: 'HS256', expiresIn: 900 },
      );
    await me(wrong).expect(401);
    await me().expect(200);
  });
  it('revokes one session without affecting another login', async () => {
    const second = (
      await request(app.getHttpServer())
        .post('/api/auth/login')
        .set('Origin', 'http://localhost:3000')
        .send({ email: 'protected@example.test', password })
        .expect(200)
    ).body.accessToken;
    await database
      .getRepository(AuthSessionEntity)
      .update(sessionId, { revokedAt: new Date() });
    await me().expect(401);
    await me(second).expect(200);
    expect(await database.getRepository(AuthSessionEntity).count()).toBe(2);
  });
});
