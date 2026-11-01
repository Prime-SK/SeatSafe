import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { DataSource } from 'typeorm';
import type { QueryRunner } from 'typeorm';
import configuredDatabase from '../dist/database/data-source.js';
import { publicBookingRows } from './support/public-booking-rows.js';
import {
  assertLocalRaceTarget,
  raceTable,
  ReadBarrier,
  prepareConnection,
  releaseConnections,
  settleAttempts,
  unsafeAttempt,
} from './support/booking-race.js';
import type { AttemptOutcome } from './support/booking-race.js';

const schema = `seatsafe_test_${randomUUID().replaceAll('-', '')}`;
const table = raceTable(schema);
const workshopId = 'one-seat-race-fixture';
const hash = (value: string | Buffer) =>
  createHash('sha256').update(value).digest('hex');

describe('Test-only booking race with real PostgreSQL', () => {
  let control: DataSource | undefined;
  let database: DataSource | undefined;
  let created = false;
  let beforeRows: string;
  let beforePrivate: string;
  let serverVersion: string;
  let runners: QueryRunner[] = [];
  const fingerprintRows = async () =>
    hash(
      JSON.stringify([
        await Promise.all(
          [
            'users',
            'auth_sessions',
            'auth_refresh_tokens',
            'workshops',
            'migrations',
          ].map((name) =>
            control!.query(`SELECT * FROM public."${name}" ORDER BY id`),
          ),
        ),
        await publicBookingRows(control!),
      ]),
    );
  const fingerprintPrivate = async () =>
    hash(
      JSON.stringify(
        await Promise.all(
          ['../.env', '../../web/public/primeui-license.local.json'].map(
            async (path) =>
              hash(await readFile(new URL(path, import.meta.url))),
          ),
        ),
      ),
    );
  beforeAll(async () => {
    const options = configuredDatabase.options;
    assertLocalRaceTarget(options, process.env.NODE_ENV);
    if (options.type !== 'postgres')
      throw new Error('The race experiment requires PostgreSQL.');
    control = new DataSource({ ...options, migrations: [], logging: false });
    await control.initialize();
    beforeRows = await fingerprintRows();
    beforePrivate = await fingerprintPrivate();
    serverVersion = (await control.query('SHOW server_version'))[0]
      .server_version as string;
    await control.query(`CREATE SCHEMA "${schema}"`);
    created = true;
    database = new DataSource({
      ...options,
      schema,
      logging: false,
      extra: {
        ...options.extra,
        max: 4,
        query_timeout: 5000,
        application_name: schema,
      },
    });
    await database.initialize();
    await database.runMigrations();
  });
  beforeEach(async () => {
    await database!.query(`DELETE FROM "${schema}".bookings`);
    await database!.query(`DELETE FROM ${table}`);
    await database!.query(
      `INSERT INTO ${table} (id, title, capacity, reserved_seats, registration_open, starts_at) VALUES ($1, $2, 1, 0, true, $3)`,
      [
        workshopId,
        'One-seat workshop: test-only race',
        new Date(Date.now() + 7 * 86400000),
      ],
    );
    runners = [database!.createQueryRunner(), database!.createQueryRunner()];
    const prepared = await Promise.allSettled(runners.map(prepareConnection));
    if (prepared.some((result) => result.status === 'rejected'))
      throw new Error('Race experiment connection preparation failed.');
    const connections = prepared.map((result) => {
      if (result.status === 'rejected')
        throw new Error('Race experiment connection preparation failed.');
      return result.value;
    });
    expect(connections[0].pid).not.toBe(connections[1].pid);
    expect(connections.map((connection) => connection.isolation)).toEqual([
      'read committed',
      'read committed',
    ]);
  });
  afterEach(async () => {
    await releaseConnections(runners);
    runners = [];
  });
  afterAll(async () => {
    try {
      if (database?.isInitialized) await database.destroy();
    } finally {
      if (control?.isInitialized) {
        try {
          if (created) {
            await control.query(`DROP SCHEMA "${schema}" CASCADE`);
            const rows = await control.query(
              'SELECT schema_name FROM information_schema.schemata WHERE schema_name = $1',
              [schema],
            );
            expect(rows).toEqual([]);
          }
          if (beforeRows) expect(await fingerprintRows()).toBe(beforeRows);
          if (beforePrivate)
            expect(await fingerprintPrivate()).toBe(beforePrivate);
          console.log(
            'Race cleanup: disposable schema removed; development rows and private configuration unchanged.',
          );
        } finally {
          await control.destroy();
        }
      }
    }
  });
  async function count(): Promise<number> {
    return (
      await database!.query(
        `SELECT reserved_seats FROM ${table} WHERE id = $1`,
        [workshopId],
      )
    )[0].reserved_seats as number;
  }
  async function report(
    experiment: string,
    concurrency: number,
    results: PromiseSettledResult<AttemptOutcome>[],
    expected: { accepted: number; rejected: number; failures: number },
  ) {
    const accepted = results.filter(
      (result) => result.status === 'fulfilled' && result.value === 'accepted',
    ).length;
    const rejected = results.filter(
      (result) => result.status === 'fulfilled' && result.value !== 'accepted',
    ).length;
    const failures = results.filter(
      (result) => result.status === 'rejected',
    ).length;
    const reserved = await count();
    console.log(
      JSON.stringify({
        experiment,
        postgres: serverVersion,
        isolation: 'READ COMMITTED',
        capacity: 1,
        attempts: results.length,
        concurrency,
        acceptedAttempts: accepted,
        eligibilityRejections: rejected,
        unexpectedFailures: failures,
        reservedSeats: reserved,
      }),
    );
    expect({ accepted, rejected, failures }).toEqual(expected);
    expect(reserved).toBe(1);
  }
  async function assertConstraint(): Promise<void> {
    const rows = await database!.query(
      `SELECT convalidated FROM pg_constraint WHERE conrelid = $1::regclass AND conname = $2`,
      [`${schema}.workshops`, 'CHK_workshops_reserved_seats_range'],
    );
    expect(rows).toEqual([{ convalidated: true }]);
  }
  it('sequential unsafe attempts accept one and reject the second as sold out', async () => {
    const first = await unsafeAttempt(runners[0], schema, workshopId);
    const second = await unsafeAttempt(runners[1], schema, workshopId);
    expect([first, second]).toEqual(['accepted', 'sold-out']);
    await report(
      'sequential unsafe attempts',
      1,
      [first, second].map((value) => ({ status: 'fulfilled', value })),
      { accepted: 1, rejected: 1, failures: 0 },
    );
  });
  it('concurrent stale absolute writes accept two attempts but store only one seat', async () => {
    const barrier = new ReadBarrier();
    const results = await settleAttempts(
      runners.map(
        (runner) => () =>
          unsafeAttempt(runner, schema, workshopId, { barrier }),
      ),
      barrier,
    );
    await assertConstraint();
    await report('concurrent unsafe attempts', 2, results, {
      accepted: 2,
      rejected: 0,
      failures: 0,
    });
  });
  it('READ COMMITTED transaction wrappers alone still allow the stale-write race', async () => {
    const barrier = new ReadBarrier();
    const results = await settleAttempts(
      runners.map(
        (runner) => () =>
          unsafeAttempt(runner, schema, workshopId, {
            barrier,
            transaction: true,
          }),
      ),
      barrier,
    );
    expect(runners.every((runner) => !runner.isTransactionActive)).toBe(true);
    await assertConstraint();
    await report('unsafe READ COMMITTED transactions', 2, results, {
      accepted: 2,
      rejected: 0,
      failures: 0,
    });
  });
  it('retains the database constraint and never accepts a failed over-capacity write', async () => {
    const accepted = await unsafeAttempt(runners[0], schema, workshopId);
    let wronglyAccepted = false;
    await runners[1].startTransaction('READ COMMITTED');
    try {
      await runners[1].query(
        `UPDATE ${table} SET reserved_seats = reserved_seats + 1 WHERE id = $1`,
        [workshopId],
      );
      await runners[1].commitTransaction();
      wronglyAccepted = true;
    } catch (error) {
      expect(error).toMatchObject({
        driverError: {
          code: '23514',
          constraint: 'CHK_workshops_reserved_seats_range',
        },
      });
    } finally {
      if (runners[1].isTransactionActive)
        await runners[1].rollbackTransaction();
    }
    expect(accepted).toBe('accepted');
    expect(wronglyAccepted).toBe(false);
    expect(await count()).toBe(1);
    await assertConstraint();
    console.log(
      JSON.stringify({
        experiment: 'constraint control',
        postgres: serverVersion,
        isolation: 'READ COMMITTED',
        capacity: 1,
        attempts: 2,
        concurrency: 1,
        acceptedAttempts: 1,
        constraintRejections: 1,
        unexpectedFailures: 0,
        reservedSeats: 1,
      }),
    );
  });
  it('aborts the barrier, settles both failed attempts and rolls back before releasing connections', async () => {
    const barrier = new ReadBarrier();
    const results = await settleAttempts(
      [
        () =>
          unsafeAttempt(runners[0], schema, workshopId, {
            barrier,
            transaction: true,
            afterRead: async () => {
              throw new Error('Injected experiment failure');
            },
          }),
        () =>
          unsafeAttempt(runners[1], schema, workshopId, {
            barrier,
            transaction: true,
          }),
      ],
      barrier,
    );
    // Each failure occurs before its write, so neither transaction may change the fixture.
    expect(results.every((result) => result.status === 'rejected')).toBe(true);
    expect(runners.every((runner) => !runner.isTransactionActive)).toBe(true);
    expect(await count()).toBe(0);
    await releaseConnections(runners);
    expect(runners.every((runner) => runner.isReleased)).toBe(true);
    runners = [];
    const fresh = database!.createQueryRunner();
    try {
      await prepareConnection(fresh);
      expect((await fresh.query('SELECT 1 AS value'))[0].value).toBe(1);
    } finally {
      await fresh.release();
    }
  });
  it('rolls back a successful UPDATE if commit fails and never returns accepted', async () => {
    const commit = vi
      .spyOn(runners[0], 'commitTransaction')
      .mockRejectedValueOnce(new Error('Injected commit failure'));
    try {
      await expect(
        unsafeAttempt(runners[0], schema, workshopId, { transaction: true }),
      ).rejects.toThrow('Injected commit failure');
      expect(runners[0].isTransactionActive).toBe(false);
      expect(await count()).toBe(0);
    } finally {
      commit.mockRestore();
    }
  });
});
