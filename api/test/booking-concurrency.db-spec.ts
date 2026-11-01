import request from 'supertest';
import { bookingFixture } from './support/booking-fixture.js';
import type { BookingFixture } from './support/booking-fixture.js';
import { BookingEntity } from '../dist/bookings/booking.entity.js';
import { WorkshopEntity } from '../dist/workshops/workshop.entity.js';
import { UserEntity } from '../dist/users/user.entity.js';
import { AuthSessionEntity } from '../dist/auth/auth-session.entity.js';

describe('Safe HTTP reservation concurrency with PostgreSQL', () => {
  let fixture: BookingFixture;
  beforeAll(async () => {
    fixture = await bookingFixture();
  });
  beforeEach(async () => {
    await fixture.reset();
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    await fixture?.close();
  });
  async function counter() {
    return (
      await fixture.database
        .getRepository(WorkshopEntity)
        .findOneByOrFail({ id: 'legacy-workshop' })
    ).reservedSeats;
  }
  async function waiting(minimum = 1) {
    const deadline = Date.now() + 4000;
    while (Date.now() < deadline) {
      const rows = await fixture.control.query(
        `SELECT count(*)::int AS count FROM pg_stat_activity WHERE application_name = $1 AND wait_event_type = 'Lock'`,
        [fixture.schema],
      );
      if (rows[0].count >= minimum) return;
      // Yield on a real database query rather than delaying correctness with a fixed sleep.
    }
    throw new Error('Reservation did not reach the controlled lock wait.');
  }
  it('100 distinct users competing through HTTP produce exactly one booking', async () => {
    const accounts = await fixture.accounts(100);
    await fixture.workshop();
    const environment = (
      await fixture.database.query(
        "SELECT current_setting('server_version') AS version, current_setting('transaction_isolation') AS isolation",
      )
    )[0] as { version: string; isolation: string };
    const results = await Promise.allSettled(
      accounts.map((user) =>
        fixture
          .reserve(user.token)
          .timeout({ response: 12000, deadline: 20000 })
          .then((result) => result),
      ),
    );
    const successes = results.filter(
      (result) => result.status === 'fulfilled' && result.value.status === 201,
    ).length;
    const full = results.filter(
      (result) =>
        result.status === 'fulfilled' &&
        result.value.status === 409 &&
        result.value.body.code === 'WORKSHOP_FULL',
    ).length;
    const transportFailures = results.filter(
      (result) => result.status === 'rejected',
    ).length;
    const timeouts = results.filter(
      (result) =>
        result.status === 'rejected' &&
        result.reason &&
        typeof result.reason === 'object' &&
        'timeout' in result.reason,
    ).length;
    const unexpected = results.length - successes - full - transportFailures;
    const bookings = await fixture.database
      .getRepository(BookingEntity)
      .countBy({ status: 'ACTIVE' });
    console.log(
      JSON.stringify({
        experiment: 'SAFE HTTP reservations',
        postgres: environment.version,
        isolation: environment.isolation,
        concurrency: 100,
        distinctUsers: 100,
        successes,
        full,
        transportFailures,
        timeouts,
        unexpected,
        activeBookings: bookings,
        reservedSeats: await counter(),
      }),
    );
    expect({
      successes,
      full,
      transportFailures,
      unexpected,
      bookings,
    }).toEqual({
      successes: 1,
      full: 99,
      transportFailures: 0,
      unexpected: 0,
      bookings: 1,
    });
    expect(timeouts).toBe(0);
    expect(await counter()).toBe(1);
  }, 30000);
  it('concurrent requests from one account consume one seat and reject duplicates', async () => {
    const [user] = await fixture.accounts();
    await fixture.workshop({ capacity: 10 });
    const results = await Promise.all(
      Array.from({ length: 12 }, () =>
        fixture.reserve(user.token).then((response) => response),
      ),
    );
    expect(results.filter((row) => row.status === 201)).toHaveLength(1);
    expect(
      results.filter(
        (row) => row.status === 409 && row.body.code === 'ALREADY_BOOKED',
      ),
    ).toHaveLength(11);
    expect(await counter()).toBe(1);
    expect(await fixture.database.getRepository(BookingEntity).count()).toBe(1);
  });
  it.each(['close', 'capacity', 'session-expiry'] as const)(
    'rechecks %s after waiting for the workshop lock',
    async (change) => {
      const [user] = await fixture.accounts();
      await fixture.workshop({ capacity: 2, reservedSeats: 1 });
      const runner = fixture.database.createQueryRunner();
      await runner.connect();
      await runner.startTransaction();
      let pending: Promise<request.Response> | undefined;
      try {
        await runner.manager
          .getRepository(WorkshopEntity)
          .createQueryBuilder('workshop')
          .setLock('pessimistic_write')
          .where('workshop.id = :id', { id: 'legacy-workshop' })
          .getOne();
        pending = fixture.reserve(user.token).then((value) => value);
        await waiting();
        if (change === 'close')
          await runner.manager
            .getRepository(WorkshopEntity)
            .update('legacy-workshop', { registrationOpen: false });
        if (change === 'capacity')
          await runner.manager
            .getRepository(WorkshopEntity)
            .update('legacy-workshop', { capacity: 1 });
        if (change === 'session-expiry') {
          // Move the application clock only after the request is admitted and blocked.
          const future = Date.now() + 8 * 86400000;
          vi.spyOn(Date, 'now').mockReturnValue(future);
        }
        await runner.commitTransaction();
        const result = await pending;
        expect(result.status).toBe(change === 'session-expiry' ? 401 : 409);
        // For the start boundary, keep session valid below in a separate case.
        if (change === 'close')
          expect(result.body.code).toBe('REGISTRATION_CLOSED');
        if (change === 'capacity')
          expect(result.body.code).toBe('WORKSHOP_FULL');
        expect(
          await fixture.database.getRepository(BookingEntity).count(),
        ).toBe(0);
        expect(await counter()).toBe(1);
      } finally {
        if (runner.isTransactionActive) await runner.rollbackTransaction();
        await runner.release();
        await pending;
      }
    },
  );
  it('rejects a workshop exactly at its start after a lock wait', async () => {
    const [user] = await fixture.accounts();
    await fixture.workshop({ startsAt: new Date(Date.now() + 60000) });
    const runner = fixture.database.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    let pending: Promise<request.Response> | undefined;
    try {
      await runner.manager
        .getRepository(WorkshopEntity)
        .createQueryBuilder('workshop')
        .setLock('pessimistic_write')
        .where('workshop.id = :id', { id: 'legacy-workshop' })
        .getOne();
      pending = fixture.reserve(user.token).then((value) => value);
      await waiting();
      const workshop = await runner.manager
        .getRepository(WorkshopEntity)
        .findOneByOrFail({ id: 'legacy-workshop' });
      vi.spyOn(Date, 'now').mockReturnValue(workshop.startsAt.getTime());
      await runner.commitTransaction();
      expect((await pending).body.code).toBe('WORKSHOP_ALREADY_STARTED');
      expect(await counter()).toBe(0);
    } finally {
      if (runner.isTransactionActive) await runner.rollbackTransaction();
      await runner.release();
      await pending;
    }
  });
  it('rechecks disabled users after the user lock wait', async () => {
    const [user] = await fixture.accounts();
    await fixture.workshop();
    const runner = fixture.database.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    let pending: Promise<request.Response> | undefined;
    try {
      await runner.manager
        .getRepository(UserEntity)
        .createQueryBuilder('user')
        .setLock('pessimistic_write')
        .where('user.id = :id', { id: user.id })
        .getOne();
      pending = fixture.reserve(user.token).then((value) => value);
      await waiting();
      await runner.manager
        .getRepository(UserEntity)
        .update(user.id, { isEnabled: false });
      await runner.commitTransaction();
      expect((await pending).status).toBe(401);
      expect(await counter()).toBe(0);
    } finally {
      if (runner.isTransactionActive) await runner.rollbackTransaction();
      await runner.release();
      await pending;
    }
  });
  it('rechecks session revocation after the user lock wait', async () => {
    const [user] = await fixture.accounts();
    await fixture.workshop();
    const runner = fixture.database.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    let pending: Promise<request.Response> | undefined;
    try {
      await runner.manager
        .getRepository(UserEntity)
        .createQueryBuilder('user')
        .setLock('pessimistic_write')
        .where('user.id = :id', { id: user.id })
        .getOne();
      pending = fixture.reserve(user.token).then((value) => value);
      await waiting();
      await runner.manager
        .getRepository(AuthSessionEntity)
        .update(user.sessionId, { revokedAt: new Date() });
      await runner.commitTransaction();
      expect((await pending).status).toBe(401);
      expect(await counter()).toBe(0);
    } finally {
      if (runner.isTransactionActive) await runner.rollbackTransaction();
      await runner.release();
      await pending;
    }
  });
  it('administrator capacity reduction cannot discard a seat committed by a competing booking', async () => {
    const [user] = await fixture.accounts();
    const [admin] = await fixture.accounts(1, 'ADMIN');
    await fixture.workshop({ capacity: 2, reservedSeats: 1 });
    const runner = fixture.database.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    const operations: Promise<request.Response>[] = [];
    try {
      await runner.manager
        .getRepository(WorkshopEntity)
        .createQueryBuilder('workshop')
        .setLock('pessimistic_write')
        .where('workshop.id = :id', { id: 'legacy-workshop' })
        .getOne();
      operations.push(fixture.reserve(user.token).then((value) => value));
      await waiting();
      operations.push(
        request(fixture.app.getHttpServer())
          .patch('/api/admin/workshops/legacy-workshop')
          .set('Authorization', `Bearer ${admin.token}`)
          .send({ capacity: 1 })
          .then((value) => value),
      );
      await waiting(2);
      await runner.commitTransaction();
      const [reservation, update] = await Promise.all(operations);
      expect(reservation.status).toBe(201);
      expect(update.status).toBe(409);
      expect(update.body.code).toBe('CAPACITY_BELOW_RESERVED');
      expect(await counter()).toBe(2);
    } finally {
      if (runner.isTransactionActive) await runner.rollbackTransaction();
      await runner.release();
      await Promise.allSettled(operations);
    }
  });
  it.each(['booking-first', 'close-first'])(
    'serializes real administrator closure with a reservation: %s',
    async (order) => {
      const [user] = await fixture.accounts();
      const [admin] = await fixture.accounts(1, 'ADMIN');
      await fixture.workshop();
      const runner = fixture.database.createQueryRunner();
      await runner.connect();
      await runner.startTransaction();
      const operations: Promise<request.Response>[] = [];
      const book = () => fixture.reserve(user.token).then((value) => value);
      const close = () =>
        request(fixture.app.getHttpServer())
          .patch('/api/admin/workshops/legacy-workshop')
          .set('Authorization', `Bearer ${admin.token}`)
          .send({ registrationOpen: false })
          .then((value) => value);
      try {
        await runner.manager
          .getRepository(WorkshopEntity)
          .createQueryBuilder('workshop')
          .setLock('pessimistic_write')
          .where('workshop.id = :id', { id: 'legacy-workshop' })
          .getOne();
        operations.push(order === 'booking-first' ? book() : close());
        await waiting();
        operations.push(order === 'booking-first' ? close() : book());
        await waiting(2);
        await runner.commitTransaction();
        const results = await Promise.all(operations);
        const reservation = results[order === 'booking-first' ? 0 : 1];
        expect(reservation.status).toBe(order === 'booking-first' ? 201 : 409);
        if (order === 'close-first')
          expect(reservation.body.code).toBe('REGISTRATION_CLOSED');
        expect(
          (
            await fixture.database
              .getRepository(WorkshopEntity)
              .findOneByOrFail({ id: 'legacy-workshop' })
          ).registrationOpen,
        ).toBe(false);
        expect(await counter()).toBe(order === 'booking-first' ? 1 : 0);
      } finally {
        if (runner.isTransactionActive) await runner.rollbackTransaction();
        await runner.release();
        await Promise.allSettled(operations);
      }
    },
  );
});
