import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { bookingFixture } from './support/booking-fixture.js';
import type { BookingFixture } from './support/booking-fixture.js';
import { BookingEntity } from '../dist/bookings/booking.entity.js';
import { WorkshopEntity } from '../dist/workshops/workshop.entity.js';
import { UserEntity } from '../dist/users/user.entity.js';
import { AuthSessionEntity } from '../dist/auth/auth-session.entity.js';

describe('Cancellation HTTP races with PostgreSQL row locks', () => {
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
  async function waiting(count = 1) {
    const deadline = Date.now() + 4000;
    while (Date.now() < deadline) {
      const rows = await fixture.control.query(
        `SELECT count(*)::int AS count FROM pg_stat_activity WHERE application_name = $1 AND wait_event_type = 'Lock'`,
        [fixture.schema],
      );
      if (rows[0].count >= count) return;
    }
    throw new Error('Cancellation did not reach the controlled lock wait');
  }
  async function invariant(expected: number) {
    const workshop = await fixture.database
      .getRepository(WorkshopEntity)
      .findOneByOrFail({ id: 'legacy-workshop' });
    expect(workshop.reservedSeats).toBe(expected);
    expect(
      await fixture.database
        .getRepository(BookingEntity)
        .countBy({ workshopId: workshop.id, status: 'ACTIVE' }),
    ).toBe(expected);
    expect(workshop.reservedSeats).toBeLessThanOrEqual(workshop.capacity);
  }
  it('20 concurrent cancellations release exactly one seat and return one cancellation timestamp', async () => {
    const [user] = await fixture.accounts();
    await fixture.workshop();
    const booking = await fixture.reserve(user.token).expect(201);
    const responses = await Promise.all(
      Array.from({ length: 20 }, () =>
        fixture
          .cancel(user.token, booking.body.id)
          .timeout({ deadline: 10000 })
          .expect(200),
      ),
    );
    for (const result of responses)
      expect(result.body).toEqual(responses[0].body);
    await invariant(0);
    expect(
      await fixture.database
        .getRepository(BookingEntity)
        .countBy({ status: 'CANCELLED' }),
    ).toBe(1);
    console.info(
      'CANCELLATION HTTP: requests=20 responses200=20 cancellationTimestamps=1 activeBookings=0 reservedSeats=0',
    );
  });
  it.each(['same-owner', 'other-owner'] as const)(
    'serializes cancellation versus %s reservation in both controlled orders',
    async (scope) => {
      // Two independent transactions per order; each iteration gets fresh isolated rows.
      for (const order of ['cancel-first', 'reserve-first'] as const) {
        await fixture.reset();
        const [owner, other] = await fixture.accounts(2);
        await fixture.workshop();
        const booking = await fixture.reserve(owner.token).expect(201);
        const key = randomUUID();
        const runner = fixture.database.createQueryRunner();
        await runner.connect();
        await runner.startTransaction();
        const operations: Promise<request.Response>[] = [];
        try {
          if (scope === 'same-owner')
            await runner.manager
              .getRepository(UserEntity)
              .createQueryBuilder('user')
              .setLock('pessimistic_write')
              .where('user.id = :id', { id: owner.id })
              .getOne();
          else
            await runner.manager
              .getRepository(WorkshopEntity)
              .createQueryBuilder('workshop')
              .setLock('pessimistic_write')
              .where('workshop.id = :id', { id: 'legacy-workshop' })
              .getOne();
          const cancel = () =>
            fixture
              .cancel(owner.token, booking.body.id)
              .then((result) => result);
          const reserve = () =>
            fixture
              .reserve(
                scope === 'same-owner' ? owner.token : other.token,
                {},
                'legacy-workshop',
                key,
              )
              .then((result) => result);
          operations.push(order === 'cancel-first' ? cancel() : reserve());
          await waiting();
          operations.push(order === 'cancel-first' ? reserve() : cancel());
          await waiting(2);
          await runner.commitTransaction();
          const results = await Promise.all(operations);
          const cancelled = results[order === 'cancel-first' ? 0 : 1];
          const reserved = results[order === 'cancel-first' ? 1 : 0];
          expect(cancelled.status).toBe(200);
          expect(reserved.status).toBe(order === 'cancel-first' ? 201 : 409);
          if (order === 'reserve-first') {
            expect(reserved.body.code).toBe(
              scope === 'same-owner' ? 'ALREADY_BOOKED' : 'WORKSHOP_FULL',
            );
            const token = scope === 'same-owner' ? owner.token : other.token;
            expect(
              (
                await fixture
                  .reserve(token, {}, 'legacy-workshop', key)
                  .expect(409)
              ).body,
            ).toEqual(reserved.body);
          }
          await invariant(order === 'cancel-first' ? 1 : 0);
        } finally {
          if (runner.isTransactionActive) await runner.rollbackTransaction();
          await runner.release();
          await Promise.allSettled(operations);
        }
      }
    },
  );
  it.each(['cancel-first', 'admin-first'] as const)(
    'serializes capacity reduction with cancellation: %s',
    async (order) => {
      const [owner, other] = await fixture.accounts(2);
      const [admin] = await fixture.accounts(1, 'ADMIN');
      await fixture.workshop({ capacity: 2 });
      const booking = await fixture.reserve(owner.token).expect(201);
      await fixture.reserve(other.token).expect(201);
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
        const cancel = () =>
          fixture.cancel(owner.token, booking.body.id).then((result) => result);
        const reduce = () =>
          request(fixture.app.getHttpServer())
            .patch('/api/admin/workshops/legacy-workshop')
            .set('Authorization', `Bearer ${admin.token}`)
            .send({ capacity: 1 })
            .then((result) => result);
        operations.push(order === 'cancel-first' ? cancel() : reduce());
        await waiting();
        operations.push(order === 'cancel-first' ? reduce() : cancel());
        await waiting(2);
        await runner.commitTransaction();
        const results = await Promise.all(operations);
        expect(results[order === 'cancel-first' ? 0 : 1].status).toBe(200);
        const update = results[order === 'cancel-first' ? 1 : 0];
        expect(update.status).toBe(order === 'cancel-first' ? 200 : 409);
        if (order === 'admin-first')
          expect(update.body.code).toBe('CAPACITY_BELOW_RESERVED');
        await invariant(1);
      } finally {
        if (runner.isTransactionActive) await runner.rollbackTransaction();
        await runner.release();
        await Promise.allSettled(operations);
      }
    },
  );
  it.each(['disabled', 'revoked'] as const)(
    'rechecks %s state after waiting for the user lock',
    async (kind) => {
      const [user] = await fixture.accounts();
      await fixture.workshop();
      const booking = await fixture.reserve(user.token).expect(201);
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
        pending = fixture
          .cancel(user.token, booking.body.id)
          .then((result) => result);
        await waiting();
        if (kind === 'disabled')
          await runner.manager
            .getRepository(UserEntity)
            .update(user.id, { isEnabled: false });
        else
          await runner.manager
            .getRepository(AuthSessionEntity)
            .update(user.sessionId, { revokedAt: new Date() });
        await runner.commitTransaction();
        expect((await pending).status).toBe(401);
        await invariant(1);
      } finally {
        if (runner.isTransactionActive) await runner.rollbackTransaction();
        await runner.release();
        await pending;
      }
    },
  );
  it('rechecks session expiry after waiting for the workshop lock', async () => {
    const [user] = await fixture.accounts();
    await fixture.workshop();
    const booking = await fixture.reserve(user.token).expect(201);
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
      pending = fixture
        .cancel(user.token, booking.body.id)
        .then((result) => result);
      await waiting();
      vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 8 * 86400000);
      await runner.commitTransaction();
      expect((await pending).status).toBe(401);
      await invariant(1);
    } finally {
      vi.restoreAllMocks();
      if (runner.isTransactionActive) await runner.rollbackTransaction();
      await runner.release();
      await pending;
    }
  });
});
