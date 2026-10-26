import { createHash, randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { Test } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types.js';
import request from 'supertest';
import { JwtService } from '@nestjs/jwt';
import configuredDatabase from '../dist/database/data-source.js';
import { UserEntity } from '../dist/users/user.entity.js';
import { AuthSessionEntity } from '../dist/auth/auth-session.entity.js';
import { AuthRefreshTokenEntity } from '../dist/auth/auth-refresh-token.entity.js';
import { PasswordHasher } from '../dist/auth/password-hasher.js';
import { seedAdminAccount } from '../dist/database/seed-admin-account.js';

const schema = `seatsafe_test_${randomUUID().replaceAll('-', '')}`;
describe('Administrator authorization and seeding with PostgreSQL', () => {
  let control: DataSource;
  let database: DataSource;
  let app: INestApplication<App>;
  let created = false;
  let snapshot: string;
  const input = {
    displayName: '  Private administrator  ',
    email: '  ADMIN@example.test ',
    password: '  unchanged 🔑 administrator password  ',
  };
  async function fingerprint() {
    const rows = await Promise.all(
      ['users', 'auth_sessions', 'auth_refresh_tokens', 'workshops'].map(
        (table) => control.query(`SELECT * FROM public."${table}" ORDER BY id`),
      ),
    );
    return createHash('sha256').update(JSON.stringify(rows)).digest('hex');
  }
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
    snapshot = await fingerprint();
    await control.query(`CREATE SCHEMA "${schema}"`);
    created = true;
    database = new DataSource({ ...options, schema, logging: false });
    await database.initialize();
    await database.runMigrations();
  });
  beforeEach(async () => {
    for (const entity of [
      AuthRefreshTokenEntity,
      AuthSessionEntity,
      UserEntity,
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
          expect(await fingerprint()).toBe(snapshot);
        } finally {
          await control.destroy();
        }
      }
    }
  });
  const access = (token: string) =>
    request(app.getHttpServer())
      .get('/api/admin/access')
      .set('Authorization', 'Bearer ' + token);
  async function login(email = 'admin@example.test') {
    const response = await request(app.getHttpServer())
      .post('/api/auth/login')
      .set('Origin', 'http://localhost:3000')
      .send({ email, password: input.password })
      .expect(200);
    return response.body.accessToken as string;
  }
  async function user() {
    return database
      .getRepository(UserEntity)
      .findOneByOrFail({ email: 'admin@example.test' });
  }
  it('normalizes and creates only an enabled ADMIN with an Argon2id hash and no session', async () => {
    expect(await seedAdminAccount(database, input)).toBe('inserted');
    const account = await user();
    expect(account).toMatchObject({
      displayName: 'Private administrator',
      email: 'admin@example.test',
      role: 'ADMIN',
      isEnabled: true,
    });
    expect(account.passwordHash).toBeUndefined();
    const stored = await database
      .getRepository(UserEntity)
      .createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .getOneOrFail();
    expect(stored.passwordHash).toMatch(/^\$argon2id\$/);
    expect(
      await new PasswordHasher().verify(stored.passwordHash, input.password),
    ).toBe(true);
    expect(await database.getRepository(AuthSessionEntity).count()).toBe(0);
  });
  it('preserves every existing field and hash on an enabled ADMIN rerun', async () => {
    await seedAdminAccount(database, input);
    const before = await database.query(`SELECT * FROM "${schema}".users`);
    expect(
      await seedAdminAccount(database, {
        ...input,
        displayName: 'Changed',
        password: 'a different valid password',
      }),
    ).toBe('skipped');
    expect(await database.query(`SELECT * FROM "${schema}".users`)).toEqual(
      before,
    );
  });
  it.each(['USER', 'disabled ADMIN'] as const)(
    'refuses to modify an existing %s',
    async (kind) => {
      await seedAdminAccount(database, input);
      const account = await user();
      await database
        .getRepository(UserEntity)
        .update(
          account.id,
          kind === 'USER' ? { role: 'USER' } : { isEnabled: false },
        );
      const before = await database.query(`SELECT * FROM "${schema}".users`);
      await expect(seedAdminAccount(database, input)).rejects.toThrow(
        'seed conflict',
      );
      expect(await database.query(`SELECT * FROM "${schema}".users`)).toEqual(
        before,
      );
    },
  );
  it('serializes concurrent seeds through email uniqueness', async () => {
    const outcomes = await Promise.all([
      seedAdminAccount(database, input),
      seedAdminAccount(database, input),
    ]);
    expect(outcomes.sort()).toEqual(['inserted', 'skipped']);
    expect(await database.getRepository(UserEntity).count()).toBe(1);
  });
  it.each([
    { email: 'invalid' },
    { displayName: '  ' },
    { password: 'short' },
    { password: ' '.repeat(20) },
    { password: '🔑'.repeat(129) },
    { role: 'ADMIN' },
  ])('rejects invalid seed input before insertion: %j', async (override) => {
    await expect(
      seedAdminAccount(database, { ...input, ...override }),
    ).rejects.toThrow('Invalid administrator details');
    expect(await database.getRepository(UserEntity).count()).toBe(0);
  });
  it('rolls back an inserted account if a later transaction step fails', async () => {
    const runner = database.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      // An outer transaction models failure after the seed insert; nested seed uses a savepoint.
      const isolated = Object.create(database) as DataSource;
      isolated.transaction = runner.manager.transaction.bind(runner.manager);
      expect(await seedAdminAccount(isolated, input)).toBe('inserted');
      await runner.rollbackTransaction();
    } finally {
      await runner.release();
    }
    expect(await database.getRepository(UserEntity).count()).toBe(0);
  });
  it('rolls back the seed insert when PostgreSQL rejects commit', async () => {
    await database.query(
      `CREATE FUNCTION "${schema}".reject_admin_commit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test commit failure'; END $$`,
    );
    await database.query(
      `CREATE CONSTRAINT TRIGGER reject_admin_commit AFTER INSERT ON "${schema}".users DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "${schema}".reject_admin_commit()`,
    );
    try {
      await expect(seedAdminAccount(database, input)).rejects.toThrow(
        'test commit failure',
      );
      expect(await database.getRepository(UserEntity).count()).toBe(0);
    } finally {
      await database.query(
        `DROP TRIGGER reject_admin_commit ON "${schema}".users`,
      );
      await database.query(`DROP FUNCTION "${schema}".reject_admin_commit()`);
    }
  });
  it('denies a registered USER and allows a seeded ADMIN through real login', async () => {
    const learner = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({
        displayName: 'Learner',
        email: 'learner@example.test',
        password: input.password,
      })
      .expect(201);
    expect(learner.body.role).toBe('USER');
    await access(await login('learner@example.test')).expect(403);
    await seedAdminAccount(database, input);
    expect((await access(await login()).expect(200)).body).toEqual({
      authorized: true,
    });
  });
  it('uses the current database role with the same token and makes no access-check writes', async () => {
    await seedAdminAccount(database, input);
    const token = await login();
    const account = await user();
    const before = await database.query(
      `SELECT * FROM "${schema}".auth_sessions ORDER BY id`,
    );
    await access(token).expect(200);
    expect(
      await database.query(
        `SELECT * FROM "${schema}".auth_sessions ORDER BY id`,
      ),
    ).toEqual(before);
    await database
      .getRepository(UserEntity)
      .update(account.id, { role: 'USER' });
    await access(token).expect(403);
    await database
      .getRepository(UserEntity)
      .update(account.id, { role: 'ADMIN' });
    await access(token).expect(200);
  });
  it.each(['disabled', 'revoked', 'expired'] as const)(
    'rejects an administrator with %s eligibility',
    async (kind) => {
      await seedAdminAccount(database, input);
      const token = await login();
      const account = await user();
      const sessionId = app.get(JwtService).verify(token).sid;
      if (kind === 'disabled')
        await database
          .getRepository(UserEntity)
          .update(account.id, { isEnabled: false });
      else
        await database
          .getRepository(AuthSessionEntity)
          .update(
            sessionId,
            kind === 'revoked'
              ? { revokedAt: new Date() }
              : { expiresAt: new Date(Date.now() - 1) },
          );
      await access(token).expect(401);
    },
  );
});
