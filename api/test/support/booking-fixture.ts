import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { DataSource } from 'typeorm';
import { Test } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import configuredDatabase from '../../dist/database/data-source.js';
import { AppModule } from '../../dist/app.module.js';
import { configureApp } from '../../dist/app.setup.js';
import { UserEntity } from '../../dist/users/user.entity.js';
import { AuthSessionEntity } from '../../dist/auth/auth-session.entity.js';
import { AuthRefreshTokenEntity } from '../../dist/auth/auth-refresh-token.entity.js';
import { WorkshopEntity } from '../../dist/workshops/workshop.entity.js';
import { BookingEntity } from '../../dist/bookings/booking.entity.js';
import { BookingIdempotencyEntity } from '../../dist/bookings/booking-idempotency.entity.js';
import { PasswordHasher } from '../../dist/auth/password-hasher.js';
import { assertLocalRaceTarget } from './booking-race.js';
import { publicBookingRows } from './public-booking-rows.js';
import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types.js';

export async function bookingFixture() {
  const options = configuredDatabase.options;
  assertLocalRaceTarget(options, process.env.NODE_ENV);
  if (options.type !== 'postgres') throw new Error('PostgreSQL required.');
  const schema = `seatsafe_test_${randomUUID().replaceAll('-', '')}`;
  const control = new DataSource({ ...options, migrations: [] });
  const database = new DataSource({
    ...options,
    schema,
    logging: false,
    extra: { ...options.extra, max: 20, application_name: schema },
  });
  const hash = (value: string | Buffer) =>
    createHash('sha256').update(value).digest('hex');
  const snapshot = async () =>
    hash(
      JSON.stringify([
        ...(await Promise.all(
          [
            'users',
            'auth_sessions',
            'auth_refresh_tokens',
            'workshops',
            'migrations',
          ].map((table) =>
            control.query(`SELECT * FROM public."${table}" ORDER BY id`),
          ),
        )),
        await publicBookingRows(control),
      ]),
    );
  const privateSnapshot = async () =>
    hash(
      JSON.stringify(
        await Promise.all(
          ['../../.env', '../../../web/public/primeui-license.local.json'].map(
            async (path) =>
              hash(await readFile(new URL(path, import.meta.url))),
          ),
        ),
      ),
    );
  let beforeRows = '';
  let beforePrivate = '';
  let created = false;
  let app: INestApplication<App> | undefined;
  async function close() {
    try {
      await app?.close();
      if (database.isInitialized) await database.destroy();
    } finally {
      if (control.isInitialized) {
        try {
          if (created) await control.query(`DROP SCHEMA "${schema}" CASCADE`);
          if (beforeRows) expect((await snapshot()) === beforeRows).toBe(true);
          if (beforePrivate)
            expect((await privateSnapshot()) === beforePrivate).toBe(true);
          expect(
            await control.query(
              'SELECT schema_name FROM information_schema.schemata WHERE schema_name = $1',
              [schema],
            ),
          ).toEqual([]);
        } finally {
          await control.destroy();
        }
      }
    }
  }
  try {
    await control.initialize();
    beforeRows = await snapshot();
    beforePrivate = await privateSnapshot();
    await control.query(`CREATE SCHEMA "${schema}"`);
    created = true;
    await database.initialize();
    await database.runMigrations();
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(getDataSourceToken())
      .useValue(database)
      .compile();
    const initializedApp: INestApplication<App> = module.createNestApplication({
      logger: false,
    });
    app = initializedApp;
    configureApp(initializedApp);
    await initializedApp.init();
    // Avoid 100 simultaneous Supertest calls racing the server's lazy listen().
    await initializedApp.listen(0, '127.0.0.1');
  } catch (error) {
    await close();
    throw error;
  }
  const application = app!;
  return {
    app: application,
    database,
    control,
    schema,
    close,
    async reset() {
      for (const entity of [
        BookingIdempotencyEntity,
        BookingEntity,
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
    },
    async accounts(count = 1, role: 'USER' | 'ADMIN' = 'USER') {
      const rows = Array.from({ length: count }, () => ({
        id: randomUUID(),
        sessionId: randomUUID(),
      }));
      await database.getRepository(UserEntity).insert(
        rows.map((row) => ({
          id: row.id,
          displayName: 'Synthetic learner',
          email: `${row.id}@example.test`,
          passwordHash: PasswordHasher.dummyHash,
          role,
          isEnabled: true,
        })),
      );
      await database.getRepository(AuthSessionEntity).insert(
        rows.map((row) => ({
          id: row.sessionId,
          userId: row.id,
          expiresAt: new Date(Date.now() + 7 * 86400000),
          revokedAt: null,
        })),
      );
      return rows.map((row) => ({
        ...row,
        token: application
          .get(JwtService)
          .sign(
            { sub: row.id, sid: row.sessionId },
            { algorithm: 'HS256', expiresIn: 900 },
          ),
      }));
    },
    workshop(overrides: Partial<WorkshopEntity> = {}) {
      return database.getRepository(WorkshopEntity).save({
        id: 'legacy-workshop',
        title: 'Isolated reservation workshop',
        capacity: 1,
        reservedSeats: 0,
        registrationOpen: true,
        startsAt: new Date(Date.now() + 7 * 86400000),
        ...overrides,
      });
    },
    reserve(
      token: string,
      body?: unknown,
      id = 'legacy-workshop',
      key: string = randomUUID(),
    ) {
      const call = request(application.getHttpServer())
        .post(`/api/workshops/${encodeURIComponent(id)}/bookings`)
        .set('Authorization', `Bearer ${token}`)
        .set('Idempotency-Key', key);
      return body === undefined
        ? call
        : call
            .set('Content-Type', 'application/json')
            .send(JSON.stringify(body));
    },
    list(token: string, suffix = '', id = 'legacy-workshop') {
      return request(application.getHttpServer())
        .get(`/api/admin/workshops/${encodeURIComponent(id)}/bookings${suffix}`)
        .set('Authorization', `Bearer ${token}`);
    },
    mine(token: string, suffix = '') {
      return request(application.getHttpServer())
        .get(`/api/bookings/me${suffix}`)
        .set('Authorization', `Bearer ${token}`);
    },
    cancel(token: string, id: string, body?: unknown) {
      const call = request(application.getHttpServer())
        .post(`/api/bookings/${encodeURIComponent(id)}/cancel`)
        .set('Authorization', `Bearer ${token}`);
      return body === undefined
        ? call
        : call
            .set('Content-Type', 'application/json')
            .send(JSON.stringify(body));
    },
  };
}
export type BookingFixture = Awaited<ReturnType<typeof bookingFixture>>;
