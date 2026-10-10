import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { Test } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types.js';
import request from 'supertest';
import * as argon2 from 'argon2';
import configuredDatabase from '../dist/database/data-source.js';
import { UserEntity } from '../dist/users/user.entity.js';

const schema = `seatsafe_test_${randomUUID().replaceAll('-', '')}`;
describe('Registration with real PostgreSQL', () => {
  let control: DataSource;
  let database: DataSource;
  let app: INestApplication<App>;
  let created = false;
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
    await database.getRepository(UserEntity).clear();
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
    // Nest closes the injected DataSource; initialize it again for the next case.
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
  const payload = {
    displayName: ' Learner ',
    email: ' Learner@Example.test ',
    password: ' unchanged long password ',
  };
  it('stores a verified hash and returns only the public fields', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send(payload)
      .expect(201);
    expect(Object.keys(response.body).sort()).toEqual([
      'displayName',
      'email',
      'id',
      'role',
    ]);
    expect(response.body).toMatchObject({
      displayName: 'Learner',
      email: 'learner@example.test',
      role: 'USER',
    });
    const user = await database
      .getRepository(UserEntity)
      .findOneByOrFail({ id: response.body.id });
    expect(user.passwordHash).toBeUndefined();
    expect(user.isEnabled).toBe(true);
    expect(user.createdAt).toBeInstanceOf(Date);
    expect(user.updatedAt).toBeInstanceOf(Date);
    const [stored] = await database.query(
      `SELECT password_hash FROM "${schema}".users WHERE id = $1`,
      [user.id],
    );
    expect(stored.password_hash).not.toBe(payload.password);
    expect(await argon2.verify(stored.password_hash, payload.password)).toBe(
      true,
    );
    expect(
      await argon2.verify(stored.password_hash, payload.password.trim()),
    ).toBe(false);
  });
  it('handles concurrent normalized duplicates with one account', async () => {
    const responses = await Promise.all([
      request(app.getHttpServer()).post('/api/auth/register').send(payload),
      request(app.getHttpServer())
        .post('/api/auth/register')
        .send({ ...payload, email: 'learner@example.test' }),
    ]);
    expect(
      responses.map((response) => response.status).sort((a, b) => a - b),
    ).toEqual([201, 409]);
    expect(
      responses.find((response) => response.status === 409)!.body.code,
    ).toBe('EMAIL_ALREADY_EXISTS');
    expect(await database.getRepository(UserEntity).count()).toBe(1);
  });
  it('generates distinct salted hashes for different accounts using the same password', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/register')
      .send(payload)
      .expect(201);
    await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ ...payload, email: 'another@example.test' })
      .expect(201);
    const rows = await database.query(
      `SELECT password_hash FROM "${schema}".users ORDER BY email`,
    );
    expect(rows[0].password_hash).not.toBe(rows[1].password_hash);
  });
  it('has aligned entity metadata, migration history and database defaults', async () => {
    expect(await database.runMigrations()).toEqual([]);
    expect(
      (await database.driver.createSchemaBuilder().log()).upQueries,
    ).toEqual([]);
    const runner = database.createQueryRunner();
    try {
      const table = await runner.getTable(`${schema}.users`);
      expect(table!.uniques.map((constraint) => constraint.name)).toContain(
        'UQ_users_email',
      );
      expect(
        table!.checks
          .map((constraint) => constraint.name)
          .sort((a, b) => a.localeCompare(b)),
      ).toEqual([
        'CHK_users_display_name_nonblank',
        'CHK_users_email_normalized',
        'CHK_users_role',
      ]);
      expect(table!.columns.find((column) => column.name === 'id')!.type).toBe(
        'uuid',
      );
      expect(
        table!.columns.find((column) => column.name === 'created_at')!.type,
      ).toBe('timestamp with time zone');
    } finally {
      await runner.release();
    }
    await database.query(
      `INSERT INTO "${schema}".users (id, display_name, email, password_hash) VALUES ($1,$2,$3,$4)`,
      [
        randomUUID(),
        'Defaults',
        'defaults@example.test',
        'test-only-placeholder',
      ],
    );
    const user = await database
      .getRepository(UserEntity)
      .findOneByOrFail({ email: 'defaults@example.test' });
    expect(user.role).toBe('USER');
    expect(user.isEnabled).toBe(true);
    expect(
      await database.query(
        `SELECT name FROM "${schema}".migrations ORDER BY id`,
      ),
    ).toHaveLength(2);
  });
  for (const [name, email, role] of [
    ['   ', 'valid@example.test', 'USER'],
    ['Valid', 'UPPER@example.test', 'USER'],
    ['Valid', ' valid@example.test ', 'USER'],
    ['Valid', 'valid@example.test', 'OWNER'],
  ] as const) {
    it(`rejects invalid database values ${name}/${email}/${role}`, async () => {
      await expect(
        database.query(
          `INSERT INTO "${schema}".users (id,display_name,email,password_hash,role) VALUES ($1,$2,$3,$4,$5)`,
          [randomUUID(), name, email, 'placeholder', role],
        ),
      ).rejects.toMatchObject({ driverError: { code: '23514' } });
    });
  }
  it('reverses and reapplies only the users migration in its temporary schema', async () => {
    await database.undoLastMigration();
    expect(
      (
        await database.query('SELECT to_regclass($1) AS name', [
          `${schema}.users`,
        ])
      )[0].name,
    ).toBeNull();
    expect(
      (
        await database.query('SELECT to_regclass($1) AS name', [
          `${schema}.workshops`,
        ])
      )[0].name,
    ).not.toBeNull();
    expect(await database.runMigrations()).toHaveLength(1);
  });
});
