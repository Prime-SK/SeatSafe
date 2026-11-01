import type { QueryRunner } from 'typeorm';

/** Test-only experiment. Never import this deliberately unsafe operation into the application. */
export type AttemptOutcome = 'accepted' | 'sold-out' | 'ineligible';

export function assertLocalRaceTarget(
  options: {
    type: string;
    host?: string;
    database?: unknown;
    url?: string;
    replication?: unknown;
  },
  environment: string | undefined,
): void {
  if (
    !['development', 'test'].includes(environment ?? '') ||
    options.type !== 'postgres' ||
    !['localhost', '127.0.0.1', '::1', '[::1]'].includes(
      options.host?.toLowerCase() ?? '',
    ) ||
    options.database !== 'seatsafe_dev' ||
    options.url ||
    options.replication
  )
    throw new Error(
      'The race experiment requires local seatsafe_dev in development/test mode.',
    );
}

export function raceTable(schema: string): string {
  if (!/^seatsafe_test_[a-f0-9]{32}$/.test(schema))
    throw new Error('Invalid race experiment schema.');
  return `"${schema}"."workshops"`;
}

/** A bounded rendezvous: nobody writes until both reads have finished. */
export class ReadBarrier {
  private arrivals = 0;
  private settled = false;
  private resolve!: () => void;
  private reject!: (error: Error) => void;
  private readonly ready: Promise<void>;
  private readonly timer: ReturnType<typeof setTimeout>;
  constructor(
    private readonly participants = 2,
    timeoutMs = 2000,
  ) {
    if (!Number.isInteger(participants) || participants < 1 || timeoutMs < 1)
      throw new Error('Invalid barrier settings.');
    this.ready = new Promise<void>((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
    });
    // A failure before the first arrival must not create an unhandled rejection.
    void this.ready.catch(() => undefined);
    this.timer = setTimeout(() => this.abort(), timeoutMs);
  }
  arrive(): Promise<void> {
    if (!this.settled && ++this.arrivals === this.participants) {
      this.settled = true;
      clearTimeout(this.timer);
      this.resolve();
    }
    return this.ready;
  }
  abort(): void {
    if (this.settled) return;
    this.settled = true;
    clearTimeout(this.timer);
    this.reject(
      new Error('Race experiment barrier stopped before all reads completed.'),
    );
  }
}

export async function prepareConnection(
  runner: QueryRunner,
): Promise<{ pid: number; isolation: string }> {
  await runner.connect();
  await runner.query(`SET statement_timeout = '5s'`);
  await runner.query(`SET lock_timeout = '3s'`);
  await runner.query(`SET idle_in_transaction_session_timeout = '7s'`);
  await runner.query(
    'SET SESSION CHARACTERISTICS AS TRANSACTION ISOLATION LEVEL READ COMMITTED',
  );
  const rows: { pid: number; isolation: string }[] = await runner.query(
    `SELECT pg_backend_pid() AS pid, current_setting('transaction_isolation') AS isolation`,
  );
  return rows[0];
}

export async function unsafeAttempt(
  runner: QueryRunner,
  schema: string,
  workshopId: string,
  options: {
    barrier?: ReadBarrier;
    transaction?: boolean;
    afterRead?: () => Promise<void>;
  } = {},
): Promise<AttemptOutcome> {
  const table = raceTable(schema);
  try {
    if (options.transaction) await runner.startTransaction('READ COMMITTED');
    const rows: {
      capacity: number;
      reserved_seats: number;
      registration_open: boolean;
      starts_at: Date;
    }[] = await runner.query(
      `SELECT capacity, reserved_seats, registration_open, starts_at FROM ${table} WHERE id = $1`,
      [workshopId],
    );
    const row = rows[0];
    let outcome: AttemptOutcome;
    if (
      !row ||
      !row.registration_open ||
      new Date(row.starts_at).getTime() <= Date.now()
    )
      outcome = 'ineligible';
    else if (row.reserved_seats >= row.capacity) outcome = 'sold-out';
    else {
      const staleNextCount = row.reserved_seats + 1;
      await options.afterRead?.();
      await options.barrier?.arrive();
      // Intentionally wrong: an absolute stale value, no lock and no availability predicate.
      await runner.query(
        `UPDATE ${table} SET reserved_seats = $1 WHERE id = $2`,
        [staleNextCount, workshopId],
      );
      outcome = 'accepted';
    }
    if (options.transaction) await runner.commitTransaction();
    return outcome;
  } catch (error) {
    options.barrier?.abort();
    if (runner.isTransactionActive) await runner.rollbackTransaction();
    throw error;
  }
}

export async function settleAttempts(
  operations: (() => Promise<AttemptOutcome>)[],
  barrier?: ReadBarrier,
): Promise<PromiseSettledResult<AttemptOutcome>[]> {
  try {
    return await Promise.allSettled(
      operations.map(async (operation) => {
        try {
          return await operation();
        } catch (error) {
          barrier?.abort();
          throw error;
        }
      }),
    );
  } finally {
    barrier?.abort();
  }
}

export async function releaseConnections(
  runners: QueryRunner[],
): Promise<void> {
  const results = await Promise.allSettled(
    runners.map(async (runner) => {
      try {
        if (runner.isTransactionActive) await runner.rollbackTransaction();
      } finally {
        if (!runner.isReleased) await runner.release();
      }
    }),
  );
  if (results.some((result) => result.status === 'rejected'))
    throw new Error('Race experiment connection cleanup failed.');
}
