import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'node:net';
import { DataSource } from 'typeorm';
import { Test } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import type { INestApplication } from '@nestjs/common';
import configured from '../dist/database/data-source.js';
import { AppModule } from '../dist/app.module.js';
import { configureApp } from '../dist/app.setup.js';
import { validateApplicationEnvironment } from '../dist/config/application-environment.js';
import { PasswordHasher } from '../dist/auth/password-hasher.js';
import { UserEntity } from '../dist/users/user.entity.js';
import { WorkshopEntity } from '../dist/workshops/workshop.entity.js';
import { seedAdminAccount } from '../dist/database/seed-admin-account.js';
import { assertLocalRaceTarget } from '../test/support/booking-race.js';
import { publicBookingRows } from '../test/support/public-booking-rows.js';
import { assertOwnership } from './safety.js';

export const password = 'public browser fixture password';
export const learner = 'learner@example.test';
export const administrator = 'admin@example.test';
export const workshopId = 'browser-workshop';
export const workshopTitle = 'Synthetic browser workshop';

async function requireFreePort(): Promise<void> {
  const probe = createServer();
  await new Promise<void>((done, reject) => {
    probe.once('error', () =>
      reject(Error('Browser API test port 3199 is occupied')),
    );
    probe.listen(3199, '127.0.0.1', () => probe.close(() => done()));
  });
}

export async function browserFixture(labEnabled = false) {
  const options = configured.options;
  assertLocalRaceTarget(options, process.env.NODE_ENV);
  assert(options.type === 'postgres', 'Local PostgreSQL required');
  await requireFreePort();
  const schema = `seatsafe_test_${randomUUID().replaceAll('-', '')}`;
  const marker = `SeatSafe browser ${randomUUID()}`;
  const control = new DataSource({
    ...options,
    entities: [],
    migrations: [],
    logging: false,
    connectTimeoutMS: 5000,
    extra: {
      max: 1,
      query_timeout: 10000,
      connectionTimeoutMillis: 5000,
      options: '-c statement_timeout=10000',
    },
  });
  const database = new DataSource({
    ...options,
    schema,
    logging: false,
    connectTimeoutMS: 5000,
    extra: {
      ...options.extra,
      max: 10,
      application_name: schema,
      query_timeout: 10000,
      connectionTimeoutMillis: 5000,
      options:
        '-c statement_timeout=10000 -c lock_timeout=5000 -c idle_in_transaction_session_timeout=15000',
    },
  });
  const hash = (value: string | Buffer) =>
    createHash('sha256').update(value).digest('hex');
  const rows = async () =>
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
  const privateFiles = async () =>
    hash(
      JSON.stringify(
        await Promise.all(
          ['.env', '../web/public/primeui-license.local.json'].map(
            async (path) => hash(await readFile(resolve(path))),
          ),
        ),
      ),
    );
  let beforeRows = '',
    beforePrivate = '',
    created = false,
    app: INestApplication | undefined;
  let closing: Promise<void> | undefined;
  async function settleDatabase() {
    if (!database.isInitialized || !control.isInitialized) return;
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      const [state] = await control.query(
        "SELECT count(*)::int AS active FROM pg_stat_activity WHERE application_name=$1 AND state <> 'idle'",
        [schema],
      );
      if (state.active === 0) return;
    }
    throw Error('Admitted browser database work did not settle');
  }
  async function start() {
    if (!database.isInitialized) await database.initialize();
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(getDataSourceToken())
      .useValue(database)
      .compile();
    app = module.createNestApplication({ logger: false });
    const validated = validateApplicationEnvironment({
      ...process.env,
      RELIABILITY_LAB_ENABLED: String(labEnabled),
    });
    app
      .get(ConfigService)
      .set('RELIABILITY_LAB_ENABLED', validated.RELIABILITY_LAB_ENABLED);
    configureApp(app);
    await app.listen(3199, '127.0.0.1');
  }
  const close = () =>
    (closing ??= (async () => {
      let failed = false;
      try {
        await settleDatabase();
      } catch {
        failed = true;
      }
      try {
        await app?.close();
      } catch {
        failed = true;
      }
      try {
        if (database.isInitialized) await database.destroy();
        if (created) {
          const current = await control.query(
            "SELECT obj_description(oid,'pg_namespace') AS marker FROM pg_namespace WHERE nspname=$1",
            [schema],
          );
          if (current.length) {
            assertOwnership(schema, marker, current[0]?.marker);
            await control.query(`DROP SCHEMA "${schema}" CASCADE`);
          }
          assert(
            (
              await control.query(
                'SELECT 1 FROM pg_namespace WHERE nspname=$1',
                [schema],
              )
            ).length === 0,
            'Browser schema removal unconfirmed',
          );
        }
        if (beforeRows)
          assert(
            beforeRows === (await rows()),
            'Development rows changed during browser verification',
          );
        if (beforePrivate)
          assert(
            beforePrivate === (await privateFiles()),
            'Private configuration changed during browser verification',
          );
        assert(!failed, 'Browser application cleanup failed');
        console.info(
          'Browser fixture: owned schema removed; development/private preservation verified',
        );
      } finally {
        if (control.isInitialized) await control.destroy();
      }
    })());
  try {
    await control.initialize();
    beforeRows = await rows();
    beforePrivate = await privateFiles();
    // Cleanup inspects the exact marker even if CREATE's commit response is lost.
    created = true;
    await control.transaction(async (manager) => {
      await manager.query(`CREATE SCHEMA "${schema}"`);
      await manager.query(`COMMENT ON SCHEMA "${schema}" IS '${marker}'`);
    });
    await database.initialize();
    await database.runMigrations();
    await seedAdminAccount(database, {
      displayName: 'Synthetic administrator',
      email: administrator,
      password,
    });
    const passwordHash = await new PasswordHasher().hash(password);
    await database.getRepository(UserEntity).insert(
      ['learner', 'other'].map((name) => ({
        id: randomUUID(),
        displayName:
          name === 'learner' ? 'Synthetic learner' : 'Other synthetic learner',
        email: `${name}@example.test`,
        passwordHash,
        role: 'USER',
        isEnabled: true,
      })),
    );
    await database.getRepository(WorkshopEntity).insert({
      id: workshopId,
      title: workshopTitle,
      capacity: 2,
      reservedSeats: 0,
      registrationOpen: true,
      startsAt: new Date(Date.now() + 14 * 86400000),
    });
    await start();
    console.info(`Browser fixture ready: ${schema}`);
  } catch {
    try {
      await close();
    } catch {
      throw Error(
        'Browser fixture setup/cleanup failed; inspect the owned fixture',
      );
    }
    throw Error('Browser fixture setup failed safely');
  }
  return {
    database,
    control,
    schema,
    close,
    async restart() {
      await settleDatabase();
      await app!.close();
      await start();
    },
    setLab(enabled: boolean) {
      const validated = validateApplicationEnvironment({
        ...process.env,
        RELIABILITY_LAB_ENABLED: String(enabled),
      });
      app!
        .get(ConfigService)
        .set('RELIABILITY_LAB_ENABLED', validated.RELIABILITY_LAB_ENABLED);
    },
    async counters() {
      const [row] = await database.query(
        `SELECT (SELECT count(*)::int FROM "${schema}".bookings WHERE status='ACTIVE') AS active, (SELECT reserved_seats FROM "${schema}".workshops WHERE id=$1) AS reserved, (SELECT count(*)::int FROM "${schema}".booking_idempotency_records) AS records`,
        [workshopId],
      );
      return row as { active: number; reserved: number; records: number };
    },
  };
}
export type BrowserFixture = Awaited<ReturnType<typeof browserFixture>>;
