import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import type { DataSourceOptions, Logger } from 'typeorm';
import { BookingsService } from '../bookings/bookings.service.js';
import { UserEntity } from '../users/user.entity.js';
import { AuthSessionEntity } from '../auth/auth-session.entity.js';
import { WorkshopEntity } from '../workshops/workshop.entity.js';
import { BookingEntity } from '../bookings/booking.entity.js';
import { BookingIdempotencyEntity } from '../bookings/booking-idempotency.entity.js';
import { PasswordHasher } from '../auth/password-hasher.js';
import { RegistrationError } from '../auth/registration-error.js';
import type { LabReport, LabScenario } from './lab.types.js';
const context = new AsyncLocalStorage<{ timeout: boolean }>();
export function observeTimeout(error: unknown): void {
  if (
    error &&
    typeof error === 'object' &&
    (('code' in error &&
      ['57014', '55P03', 'ETIMEDOUT'].includes(String(error.code))) ||
      (error instanceof Error && /timeout|timed out/i.test(error.message)))
  ) {
    const current = context.getStore();
    if (current) current.timeout = true;
  }
}
const logger: Logger = {
  logQuery() {},
  logQueryError(error) {
    observeTimeout(error);
  },
  logQuerySlow() {},
  logSchemaBuild() {},
  logMigration() {},
  log() {},
};
export interface LabContext {
  schema: string;
  marker: string;
  control: DataSource;
  database: DataSource;
}
export class LabRunner {
  constructor(
    private readonly base: DataSourceOptions,
    private readonly make = (options: DataSourceOptions) =>
      new DataSource(options),
    private readonly now = () => Date.now(),
  ) {}
  create(): LabContext {
    if (
      this.base.type !== 'postgres' ||
      this.base.database !== 'seatsafe_dev' ||
      !['localhost', '127.0.0.1', '::1', '[::1]'].includes(
        this.base.host?.toLowerCase() ?? '',
      ) ||
      this.base.url ||
      this.base.replication
    )
      throw Error('Lab requires local seatsafe_dev');
    const schema = `seatsafe_lab_${randomUUID().replaceAll('-', '')}`,
      marker = `SeatSafe lab ${randomUUID()}`;
    const common = {
      ...this.base,
      synchronize: false,
      migrationsRun: false,
      logging: false,
      logger,
      connectTimeoutMS: 5000,
      extra: {
        connectionTimeoutMillis: 5000,
        query_timeout: 5000,
        options:
          '-c statement_timeout=5000 -c lock_timeout=3000 -c idle_in_transaction_session_timeout=7000 -c default_transaction_isolation=read\\ committed',
      },
    };
    return {
      schema,
      marker,
      control: this.make({
        ...common,
        entities: [],
        migrations: [],
        extra: { ...common.extra, max: 1 },
      }),
      database: this.make({
        ...common,
        schema,
        extra: { ...common.extra, max: 9, application_name: schema },
      }),
    };
  }
  async prepare(job: LabContext, report: LabReport): Promise<void> {
    await job.control.initialize();
    await job.control.transaction(async (manager) => {
      await manager.query(`CREATE SCHEMA "${job.schema}"`);
      await manager.query(
        `COMMENT ON SCHEMA "${job.schema}" IS '${job.marker}'`,
      );
    });
    await job.database.initialize();
    await job.database.runMigrations();
    const [environment] = await job.database.query(
      "SELECT current_setting('server_version') AS version, current_setting('transaction_isolation') AS isolation",
    );
    report.postgres = environment.version;
    report.isolation = environment.isolation;
    if (report.isolation !== 'read committed')
      throw Error('Unexpected lab isolation');
  }
  async execute(job: LabContext, report: LabReport): Promise<void> {
    const database = job.database;
    // Observe connection timeouts before the booking service maps failures to safe API errors.
    const create = database.createQueryRunner.bind(database);
    database.createQueryRunner = (mode) => {
      const runner = create(mode),
        connect = runner.connect.bind(runner);
      runner.connect = () =>
        connect().catch((error: unknown) => {
          observeTimeout(error);
          throw error;
        });
      return runner;
    };
    const count = report.scenario === 'seat-contention' ? 100 : 1;
    const users = Array.from({ length: count }, () => ({
      id: randomUUID(),
      sessionId: randomUUID(),
    }));
    await database.getRepository(UserEntity).insert(
      users.map((user, i) => ({
        id: user.id,
        displayName: `Synthetic ${i + 1}`,
        email: `synthetic-${i + 1}@example.test`,
        passwordHash: PasswordHasher.dummyHash,
        role: 'USER',
        isEnabled: true,
      })),
    );
    await database.getRepository(AuthSessionEntity).insert(
      users.map((user) => ({
        id: user.sessionId,
        userId: user.id,
        expiresAt: new Date(this.now() + 7 * 86400000),
        revokedAt: null,
      })),
    );
    const workshopId = 'lab-workshop';
    await database.getRepository(WorkshopEntity).insert({
      id: workshopId,
      title: 'Isolated reliability workshop',
      capacity: 1,
      reservedSeats: 0,
      registrationOpen: true,
      startsAt: new Date(this.now() + 7 * 86400000),
    });
    const service = new BookingsService(database),
      sharedKey = randomUUID(),
      snapshots: string[] = [],
      bookingIds = new Set<string>();
    let cursor = 0;
    const deadline = this.now() + 60000;
    report.stage = 'executing';
    const workers = await Promise.allSettled(
      Array.from({ length: 9 }, async () => {
        while (cursor < report.requested) {
          const index = cursor++;
          const userIndex = report.scenario === 'seat-contention' ? index : 0,
            user = users[userIndex]!;
          const attempt = {
            attempt: index + 1,
            userLabel: `User ${userIndex + 1}`,
            outcome: 'undispatched' as
              | 'success'
              | 'conflict'
              | 'timeout'
              | 'unexpected'
              | 'undispatched',
            code: undefined as string | undefined,
          };
          report.attempts[index] = attempt;
          if (this.now() >= deadline) {
            report.undispatched++;
            continue;
          }
          const tracking = { timeout: false };
          try {
            const value = await context.run(tracking, () =>
              service.reserve(
                {
                  id: user.id,
                  sessionId: user.sessionId,
                  displayName: 'Synthetic',
                  email: 'synthetic@example.test',
                  role: 'USER',
                },
                workshopId,
                report.scenario === 'matching-key' ? sharedKey : randomUUID(),
              ),
            );
            attempt.outcome = 'success';
            report.successes++;
            bookingIds.add(value.id);
            snapshots.push(
              JSON.stringify([
                value.id,
                value.workshopId,
                value.status,
                value.createdAt,
                value.cancelledAt,
              ]),
            );
          } catch (error) {
            if (tracking.timeout) {
              attempt.outcome = 'timeout';
              report.timeouts++;
            } else if (
              error instanceof RegistrationError &&
              error.getStatus() === 409
            ) {
              const body = error.getResponse() as { code?: string };
              if (
                body.code === 'WORKSHOP_FULL' ||
                body.code === 'ALREADY_BOOKED'
              ) {
                attempt.outcome = 'conflict';
                attempt.code = body.code;
                report.conflicts[body.code] =
                  (report.conflicts[body.code] ?? 0) + 1;
              } else {
                attempt.outcome = 'unexpected';
                report.unexpected++;
              }
            } else {
              attempt.outcome = 'unexpected';
              report.unexpected++;
            }
          }
        }
      }),
    );
    report.unexpected += workers.filter(
      (worker) => worker.status === 'rejected',
    ).length;
    report.uniqueBookings = bookingIds.size;
    report.matchingSnapshots =
      snapshots.length > 0 &&
      snapshots.every((value) => value === snapshots[0]);
    report.activeBookings = await database
      .getRepository(BookingEntity)
      .countBy({ status: 'ACTIVE' });
    report.reservedSeats = (
      await database
        .getRepository(WorkshopEntity)
        .findOneByOrFail({ id: workshopId })
    ).reservedSeats;
    report.idempotencyRecords = await database
      .getRepository(BookingIdempotencyEntity)
      .count();
    const matching = report.scenario === 'matching-key';
    report.invariantsPassed =
      report.attempts.length === report.requested &&
      report.timeouts === 0 &&
      report.unexpected === 0 &&
      report.undispatched === 0 &&
      report.activeBookings === 1 &&
      report.reservedSeats === 1 &&
      report.uniqueBookings === 1 &&
      report.successes === (matching ? 20 : 1) &&
      report.idempotencyRecords === (matching ? 1 : report.requested) &&
      (matching
        ? report.matchingSnapshots
        : report.conflicts[
            report.scenario === 'seat-contention'
              ? 'WORKSHOP_FULL'
              : 'ALREADY_BOOKED'
          ] ===
          report.requested - 1);
  }
  async cleanup(job: LabContext): Promise<void> {
    if (
      !/^seatsafe_lab_[a-f0-9]{32}$/.test(job.schema) ||
      !/^SeatSafe lab [a-f0-9-]{36}$/.test(job.marker)
    )
      throw Error('Invalid owned lab schema');
    if (job.database.isInitialized) await job.database.destroy();
    if (!job.control.isInitialized) await job.control.initialize();
    const rows = await job.control.query(
      "SELECT obj_description(oid,'pg_namespace') AS marker FROM pg_namespace WHERE nspname=$1",
      [job.schema],
    );
    if (rows.length) {
      if (rows[0].marker !== job.marker)
        throw Error('Schema ownership could not be verified');
      await job.control.query(`DROP SCHEMA "${job.schema}" CASCADE`);
    }
    await job.control.destroy();
  }
}
export function newReport(runId: string, scenario: LabScenario): LabReport {
  return {
    runId,
    scenario,
    status: 'running',
    stage: 'preparing',
    startedAt: new Date().toISOString(),
    completedAt: null,
    postgres: null,
    isolation: null,
    requested: scenario === 'seat-contention' ? 100 : 20,
    workers: 9,
    attempts: [],
    successes: 0,
    conflicts: {},
    timeouts: 0,
    unexpected: 0,
    undispatched: 0,
    capacity: 1,
    activeBookings: null,
    reservedSeats: null,
    idempotencyRecords: null,
    uniqueBookings: 0,
    matchingSnapshots: false,
    invariantsPassed: false,
    cleanup: 'pending',
    message: 'Preparing isolated internal booking-service attempts',
  };
}
