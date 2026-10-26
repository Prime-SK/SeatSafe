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
import { JwtService } from '@nestjs/jwt';
import { AccessTokenService } from '../dist/auth/access-token.service.js';

const schema = `seatsafe_test_${randomUUID().replaceAll('-', '')}`;
describe('Rotating sessions with real PostgreSQL', () => {
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
  const login = async () => {
    const result = await request(app.getHttpServer())
      .post('/api/auth/login')
      .set('Origin', 'http://localhost:3000')
      .send({ email: 'learner@example.test', password })
      .expect(200);
    return {
      cookie: result.headers['set-cookie'][0].split(';')[0],
      token: result.body.accessToken as string,
    };
  };
  const rotate = (cookie: string) =>
    request(app.getHttpServer())
      .post('/api/auth/refresh')
      .set('Origin', 'http://localhost:3000')
      .set('Cookie', cookie);
  const logout = (cookie: string) =>
    request(app.getHttpServer())
      .post('/api/auth/logout')
      .set('Origin', 'http://localhost:3000')
      .set('Cookie', cookie);
  const me = (token: string) =>
    request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', 'Bearer ' + token);
  const credentials = () => database.getRepository(AuthRefreshTokenEntity);
  const all = () =>
    credentials()
      .createQueryBuilder('credential')
      .addSelect('credential.tokenHash')
      .orderBy('credential.createdAt', 'ASC')
      .addOrderBy('credential.id', 'ASC')
      .getMany();
  it('rotates after access expiry, retains history, reads current profile and preserves fixed session expiry', async () => {
    const first = await login();
    const original = (
      await database.getRepository(AuthSessionEntity).find()
    )[0];
    const expired = app.get(JwtService).sign(
      {
        sub: _userId,
        sid: original.id,
        iat: Math.floor(Date.now() / 1000) - 1200,
      },
      { algorithm: 'HS256', expiresIn: 900 },
    );
    await me(expired).expect(401);
    await database.getRepository(UserEntity).update(_userId, {
      displayName: 'Updated learner',
      role: 'ADMIN',
      email: 'updated@example.test',
    });
    const result = await rotate(first.cookie)
      .set('Authorization', 'Bearer ' + expired)
      .send({ userId: 'forged' })
      .expect(200);
    expect(result.body.user).toEqual({
      id: _userId,
      displayName: 'Updated learner',
      email: 'updated@example.test',
      role: 'ADMIN',
    });
    expect(Object.keys(result.body).sort()).toEqual([
      'accessToken',
      'expiresIn',
      'tokenType',
      'user',
    ]);
    const claims = app.get(JwtService).verify(result.body.accessToken);
    expect(claims.sub).toBe(_userId);
    expect(claims.sid).toBe(original.id);
    expect(claims.exp - claims.iat).toBe(900);
    expect(Object.keys(claims).sort()).toEqual(['exp', 'iat', 'sid', 'sub']);
    const rows = await all();
    expect(rows).toHaveLength(2);
    expect(rows.filter((row) => row.consumedAt === null)).toHaveLength(1);
    expect(
      rows.find(
        (row) =>
          row.tokenHash ===
          createHash('sha256').update(first.cookie.split('=')[1]).digest('hex'),
      )!.consumedAt,
    ).not.toBeNull();
    const replacement = result.headers['set-cookie'][0];
    expect(replacement.split(';')[0]).not.toBe(first.cookie);
    expect(
      rows.some(
        (row) =>
          row.tokenHash ===
          createHash('sha256')
            .update(replacement.split(';')[0].split('=')[1])
            .digest('hex'),
      ),
    ).toBe(true);
    expect(replacement).toContain('HttpOnly');
    expect(replacement).toContain('SameSite=Lax');
    expect(replacement).toContain('Path=/api/auth');
    expect(new Date(replacement.match(/Expires=([^;]+)/)![1]).getTime()).toBe(
      Math.floor(original.expiresAt.getTime() / 1000) * 1000,
    );
    expect(
      await database
        .getRepository(AuthSessionEntity)
        .findOneByOrFail({ id: original.id }),
    ).toEqual(original);
    await me(result.body.accessToken).expect(200);
  });
  it('commits session revocation on consumed-token reuse and preserves other sessions', async () => {
    const first = await login(),
      other = await login();
    const result = await rotate(first.cookie).expect(200);
    await rotate(first.cookie).expect(401);
    await me(first.token).expect(401);
    await me(result.body.accessToken).expect(401);
    await rotate(result.headers['set-cookie'][0].split(';')[0]).expect(401);
    await me(other.token).expect(200);
    await rotate(other.cookie).expect(200);
    expect(await credentials().count()).toBe(4);
    expect(
      (await database.getRepository(AuthSessionEntity).find()).filter(
        (value) => value.revokedAt !== null,
      ),
    ).toHaveLength(1);
  });
  it.each(['disabled', 'expired', 'revoked'])(
    'rejects %s sessions without consuming the current credential',
    async (kind) => {
      const first = await login();
      const session = (
        await database.getRepository(AuthSessionEntity).find()
      )[0];
      if (kind === 'disabled')
        await database
          .getRepository(UserEntity)
          .update(_userId, { isEnabled: false });
      if (kind === 'expired')
        await database
          .getRepository(AuthSessionEntity)
          .update(session.id, { expiresAt: new Date(0) });
      if (kind === 'revoked')
        await database
          .getRepository(AuthSessionEntity)
          .update(session.id, { revokedAt: new Date() });
      const before = await all();
      await rotate(first.cookie).expect(401);
      expect(await all()).toEqual(before);
    },
  );
  it('rejects expiry exactly at the eligibility check instant', async () => {
    const first = await login(),
      instant = new Date('2030-01-01T00:00:00Z');
    const session = (await database.getRepository(AuthSessionEntity).find())[0];
    await database
      .getRepository(AuthSessionEntity)
      .update(session.id, { expiresAt: instant });
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(instant);
    try {
      await rotate(first.cookie).expect(401);
    } finally {
      vi.useRealTimers();
    }
    expect((await all())[0].consumedAt).toBeNull();
  });
  it.each(['generation', 'insert', 'signing', 'commit'])(
    'rolls back rotation on %s failure, preserves the cookie and permits retry',
    async (kind) => {
      const first = await login();
      const before = await all();
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
      if (kind === 'insert' || kind === 'commit') {
        await database.query(
          `CREATE OR REPLACE FUNCTION "${schema}".fail_rotation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'private SQL'; END $$`,
        );
        await database.query(
          kind === 'insert'
            ? `CREATE TRIGGER fail_rotation BEFORE INSERT ON "${schema}".auth_refresh_tokens FOR EACH ROW EXECUTE FUNCTION "${schema}".fail_rotation()`
            : `CREATE CONSTRAINT TRIGGER fail_rotation AFTER INSERT ON "${schema}".auth_refresh_tokens DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "${schema}".fail_rotation()`,
        );
      }
      const result = await rotate(first.cookie).expect(
        kind === 'generation' || kind === 'signing' ? 500 : 503,
      );
      expect(result.headers['set-cookie']).toBeUndefined();
      expect(JSON.stringify(result.body)).not.toContain('private');
      expect(await all()).toEqual(before);
      if (kind === 'insert' || kind === 'commit')
        await database.query(
          `DROP TRIGGER fail_rotation ON "${schema}".auth_refresh_tokens`,
        );
      vi.restoreAllMocks();
      await rotate(first.cookie).expect(200);
    },
  );
  it('serializes simultaneous uses into one rotation and one committed revocation', async () => {
    const first = await login();
    const results = await Promise.all([
      rotate(first.cookie),
      rotate(first.cookie),
    ]);
    expect(results.map((value) => value.status).sort((a, b) => a - b)).toEqual([
      200, 401,
    ]);
    const success = results.find((value) => value.status === 200)!;
    expect(await credentials().count()).toBe(2);
    expect((await all()).filter((row) => row.consumedAt === null)).toHaveLength(
      1,
    );
    expect(
      (await database.getRepository(AuthSessionEntity).find())[0].revokedAt,
    ).not.toBeNull();
    await me(success.body.accessToken).expect(401);
    await rotate(success.headers['set-cookie'][0].split(';')[0]).expect(401);
  });
  it('serializes refresh versus logout so no usable successor survives', async () => {
    const first = await login();
    const [refreshed, loggedOut] = await Promise.all([
      rotate(first.cookie),
      logout(first.cookie),
    ]);
    expect([200, 401]).toContain(refreshed.status);
    expect(loggedOut.status).toBe(204);
    await me(first.token).expect(401);
    if (refreshed.status === 200) {
      await me(refreshed.body.accessToken).expect(401);
      await rotate(refreshed.headers['set-cookie'][0].split(';')[0]).expect(
        401,
      );
    }
    expect(
      (await database.getRepository(AuthSessionEntity).find())[0].revokedAt,
    ).not.toBeNull();
  });
  it('logs out with a consumed credential, preserves history and supports repeat logout', async () => {
    const first = await login(),
      other = await login();
    const refreshed = await rotate(first.cookie).expect(200);
    const before = await all();
    const result = await logout(first.cookie).expect(204);
    expect(result.text).toBe('');
    expect(result.headers['set-cookie'][0]).toContain(
      'Expires=Thu, 01 Jan 1970',
    );
    const sessions = await database.getRepository(AuthSessionEntity).find();
    await logout(first.cookie).expect(204);
    expect(await database.getRepository(AuthSessionEntity).find()).toEqual(
      sessions,
    );
    expect(await all()).toEqual(before);
    await me(refreshed.body.accessToken).expect(401);
    await me(other.token).expect(200);
  });
  it('allows logout for disabled and expired sessions without an access token', async () => {
    const first = await login();
    await database
      .getRepository(UserEntity)
      .update(_userId, { isEnabled: false });
    await database
      .getRepository(AuthSessionEntity)
      .update({ userId: _userId }, { expiresAt: new Date(0) });
    await logout(first.cookie).expect(204);
    expect(
      (await database.getRepository(AuthSessionEntity).find())[0].revokedAt,
    ).not.toBeNull();
  });
  it.each(['logout', 'reuse'])(
    'retains the cookie and rolls back revocation when %s commit fails',
    async (operation) => {
      const first = await login();
      if (operation === 'reuse') await rotate(first.cookie).expect(200);
      await database.query(
        `CREATE OR REPLACE FUNCTION "${schema}".fail_revocation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'private revocation'; END $$`,
      );
      await database.query(
        `CREATE CONSTRAINT TRIGGER fail_revocation AFTER UPDATE ON "${schema}".auth_sessions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "${schema}".fail_revocation()`,
      );
      const result = await (
        operation === 'logout' ? logout(first.cookie) : rotate(first.cookie)
      ).expect(503);
      expect(result.headers['set-cookie']).toBeUndefined();
      expect(
        (await database.getRepository(AuthSessionEntity).find())[0].revokedAt,
      ).toBeNull();
      await database.query(
        `DROP TRIGGER fail_revocation ON "${schema}".auth_sessions`,
      );
      await logout(first.cookie).expect(204);
      await me(first.token).expect(401);
    },
  );
});
