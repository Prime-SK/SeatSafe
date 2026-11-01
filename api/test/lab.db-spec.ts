import { randomUUID } from 'node:crypto';
import { vi } from 'vitest';
import { bookingFixture } from './support/booking-fixture.js';
import type { BookingFixture } from './support/booking-fixture.js';
import { LabRunner, newReport } from '../dist/reliability/lab-runner.js';
describe('Isolated local reliability lab database experiments', () => {
  it.each(['timeout', 'unexpected'] as const)(
    'classifies %s failure and rolls back the admitted attempt',
    async (kind) => {
      const runner = new LabRunner(f.database.options),
        job = runner.create(),
        report = newReport(randomUUID(), 'matching-key');
      report.requested = 1;
      try {
        await runner.prepare(job, report);
        await job.database.query(
          `CREATE FUNCTION "${job.schema}".lab_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN ${kind === 'timeout' ? 'PERFORM pg_sleep(6);' : "RAISE EXCEPTION 'private synthetic error';"} RETURN NEW; END $$`,
        );
        await job.database.query(
          `CREATE TRIGGER lab_failure BEFORE INSERT ON "${job.schema}".bookings FOR EACH ROW EXECUTE FUNCTION "${job.schema}".lab_failure()`,
        );
        await runner.execute(job, report);
        expect(report.invariantsPassed).toBe(false);
        expect(report.activeBookings).toBe(0);
        expect(report.reservedSeats).toBe(0);
        expect(report.idempotencyRecords).toBe(0);
        expect(kind === 'timeout' ? report.timeouts : report.unexpected).toBe(
          1,
        );
        expect(JSON.stringify(report)).not.toContain('private synthetic');
      } finally {
        await runner.cleanup(job);
      }
    },
    20000,
  );
  let f: BookingFixture;
  beforeAll(async () => {
    f = await bookingFixture();
  });
  afterAll(async () => {
    await f?.close();
  });
  it.each(['seat-contention', 'matching-key', 'different-keys'] as const)(
    'executes the real booking service scenario %s and removes only its owned schema',
    async (scenario) => {
      const runner = new LabRunner(f.database.options),
        job = runner.create(),
        report = newReport(randomUUID(), scenario);
      try {
        await runner.prepare(job, report);
        await runner.execute(job, report);
        expect(report.invariantsPassed).toBe(true);
        expect(report.activeBookings).toBe(1);
        expect(report.reservedSeats).toBe(1);
        expect(report.unexpected).toBe(0);
        expect(JSON.stringify(report)).not.toMatch(
          /password|accessToken|tokenHash/,
        );
        console.info(
          JSON.stringify({
            scenario,
            internalAttempts: report.requested,
            successes: report.successes,
            conflicts: report.conflicts,
            records: report.idempotencyRecords,
            active: report.activeBookings,
            reserved: report.reservedSeats,
            postgres: report.postgres,
            isolation: report.isolation,
          }),
        );
      } finally {
        await runner.cleanup(job);
      }
      expect(
        await f.control.query(
          'SELECT nspname FROM pg_namespace WHERE nspname=$1',
          [job.schema],
        ),
      ).toEqual([]);
    },
  );
  it('refuses cleanup when a schema ownership marker differs', async () => {
    const runner = new LabRunner(f.database.options),
      job = runner.create();
    try {
      await runner.prepare(job, newReport(randomUUID(), 'matching-key'));
      const original = job.marker;
      job.marker = `SeatSafe lab ${randomUUID()}`;
      await expect(runner.cleanup(job)).rejects.toThrow('ownership');
      job.marker = original;
    } finally {
      await runner.cleanup(job);
    }
  });
  it('cleans setup failure after schema creation', async () => {
    const runner = new LabRunner(f.database.options),
      job = runner.create();
    vi.spyOn(job.database, 'runMigrations').mockRejectedValue(
      Error('fixture setup failure'),
    );
    try {
      await expect(
        runner.prepare(job, newReport(randomUUID(), 'matching-key')),
      ).rejects.toThrow();
    } finally {
      await runner.cleanup(job);
      vi.restoreAllMocks();
    }
    expect(
      await f.control.query(
        'SELECT nspname FROM pg_namespace WHERE nspname=$1',
        [job.schema],
      ),
    ).toEqual([]);
  });
  it('records undispatched attempts after the deadline without claiming a pass', async () => {
    let calls = 0;
    const runner = new LabRunner(f.database.options, undefined, () =>
        ++calls > 3 ? Date.now() + 120000 : Date.now(),
      ),
      job = runner.create(),
      report = newReport(randomUUID(), 'matching-key');
    try {
      await runner.prepare(job, report);
      await runner.execute(job, report);
      expect(report.undispatched).toBeGreaterThan(0);
      expect(report.invariantsPassed).toBe(false);
    } finally {
      await runner.cleanup(job);
    }
  });
});
