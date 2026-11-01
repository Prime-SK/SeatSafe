import { randomUUID, createHash } from 'node:crypto';
import { QueryFailedError } from 'typeorm';
import { bookingFixture } from './support/booking-fixture.js';
import type { BookingFixture } from './support/booking-fixture.js';
import { BookingEntity } from '../dist/bookings/booking.entity.js';
import { WorkshopEntity } from '../dist/workshops/workshop.entity.js';
import { UserEntity } from '../dist/users/user.entity.js';
import { AuthSessionEntity } from '../dist/auth/auth-session.entity.js';
import { BookingIdempotencyEntity } from '../dist/bookings/booking-idempotency.entity.js';

describe('Owned history and cancellation with PostgreSQL', () => {
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
  async function reserved() {
    return (
      await fixture.database
        .getRepository(WorkshopEntity)
        .findOneByOrFail({ id: 'legacy-workshop' })
    ).reservedSeats;
  }
  async function snapshots() {
    return createHash('sha256')
      .update(
        JSON.stringify(
          await Promise.all(
            [
              'users',
              'auth_sessions',
              'auth_refresh_tokens',
              'workshops',
              'bookings',
              'booking_idempotency_records',
            ].map((table) =>
              fixture.database.query(
                `SELECT * FROM "${fixture.schema}"."${table}" ORDER BY id`,
              ),
            ),
          ),
        ),
      )
      .digest('hex');
  }
  it.each(['USER', 'ADMIN'] as const)(
    'allows %s to cancel once and preserves reservation outcomes',
    async (role) => {
      const [user] = await fixture.accounts(1, role);
      await fixture.workshop();
      const key = randomUUID();
      const original = await fixture
        .reserve(user.token, {}, 'legacy-workshop', key)
        .expect(201);
      const records = await fixture.database
        .getRepository(BookingIdempotencyEntity)
        .find();
      const first = await fixture
        .cancel(user.token, original.body.id)
        .expect(200);
      expect(first.body).toEqual({
        ...original.body,
        status: 'CANCELLED',
        cancelledAt: expect.any(String),
      });
      expect(first.headers['cache-control']).toBe('no-store');
      expect(first.headers['set-cookie']).toBeUndefined();
      expect(await reserved()).toBe(0);
      const beforeRetry = await snapshots();
      expect(
        (await fixture.cancel(user.token, original.body.id, {}).expect(200))
          .body,
      ).toEqual(first.body);
      expect(await snapshots()).toBe(beforeRetry);
      expect(
        await fixture.database.getRepository(BookingIdempotencyEntity).find(),
      ).toEqual(records);
      expect(
        (
          await fixture
            .reserve(user.token, {}, 'legacy-workshop', key)
            .expect(201)
        ).body,
      ).toEqual(original.body);
      expect(await reserved()).toBe(0);
      const next = await fixture.reserve(user.token).expect(201);
      expect(next.body.id).not.toBe(original.body.id);
      expect(
        (await fixture.cancel(user.token, original.body.id).expect(200)).body,
      ).toEqual(first.body);
      expect(await reserved()).toBe(1);
      expect(
        await fixture.database
          .getRepository(BookingEntity)
          .countBy({ status: 'ACTIVE' }),
      ).toBe(1);
      expect(
        await fixture.database
          .getRepository(BookingEntity)
          .countBy({ status: 'CANCELLED' }),
      ).toBe(1);
    },
  );
  it.each(['open', 'closed', 'past', 'closed-past', 'full'] as const)(
    'cancels a %s workshop booking',
    async (state) => {
      const [user] = await fixture.accounts();
      await fixture.workshop();
      const original = await fixture.reserve(user.token).expect(201);
      await fixture.database
        .getRepository(WorkshopEntity)
        .update('legacy-workshop', {
          registrationOpen: !state.includes('closed'),
          startsAt: new Date(state.includes('past') ? 0 : Date.now() + 60000),
        });
      await fixture.cancel(user.token, original.body.id).expect(200);
      expect(await reserved()).toBe(0);
    },
  );
  it('returns identical 404 for unknown and foreign-owned bookings, including an ADMIN caller', async () => {
    const [owner] = await fixture.accounts();
    const [other] = await fixture.accounts(1, 'ADMIN');
    await fixture.workshop();
    const booking = await fixture.reserve(owner.token).expect(201);
    const before = await snapshots();
    const foreign = await fixture
      .cancel(other.token, booking.body.id)
      .expect(404);
    const missing = await fixture.cancel(other.token, randomUUID()).expect(404);
    expect(foreign.body).toEqual({
      statusCode: 404,
      code: 'BOOKING_NOT_FOUND',
      message: 'Booking not found',
    });
    expect(missing.body).toEqual(foreign.body);
    expect(await snapshots()).toBe(before);
  });
  it('lists only owned ACTIVE/CANCELLED history with stable descending order and current seven-field workshops', async () => {
    const [owner, other] = await fixture.accounts(2);
    await fixture.workshop({ capacity: 2 });
    await fixture.workshop({ id: 'another' });
    const first = await fixture.reserve(owner.token).expect(201);
    const second = await fixture
      .reserve(owner.token, {}, 'another')
      .expect(201);
    await fixture.reserve(other.token).expect(201);
    await fixture.cancel(owner.token, first.body.id).expect(200);
    const date = new Date('2030-01-01T00:00:00Z');
    await fixture.database
      .getRepository(BookingEntity)
      .update({ userId: owner.id }, { createdAt: date });
    await fixture.database
      .getRepository(WorkshopEntity)
      .update('legacy-workshop', {
        title: 'Current workshop title',
        capacity: 4,
      });
    const before = await snapshots();
    const result = await fixture.mine(owner.token).expect(200);
    expect(result.body).toMatchObject({ total: 2, page: 1, limit: 25 });
    expect(result.body.items.map((row: { id: string }) => row.id)).toEqual(
      [first.body.id, second.body.id].sort((a: string, b: string) =>
        b.localeCompare(a),
      ),
    );
    const item = result.body.items.find(
      (row: { id: string }) => row.id === first.body.id,
    );
    expect(Object.keys(item).sort()).toEqual(
      [
        'id',
        'workshopId',
        'status',
        'createdAt',
        'cancelledAt',
        'workshop',
      ].sort(),
    );
    expect(item.status).toBe('CANCELLED');
    expect(Object.keys(item.workshop).sort()).toEqual(
      [
        'id',
        'title',
        'capacity',
        'reservedSeats',
        'registrationOpen',
        'availableSeats',
        'startsAt',
      ].sort(),
    );
    expect(item.workshop).toMatchObject({
      title: 'Current workshop title',
      capacity: 4,
      reservedSeats: 1,
      availableSeats: 3,
    });
    const page = await fixture.mine(owner.token, '?page=2&limit=1').expect(200);
    expect(page.body).toMatchObject({
      total: 2,
      page: 2,
      limit: 1,
      items: [result.body.items[1]],
    });
    expect(
      (await fixture.mine(owner.token, '?page=3&limit=1').expect(200)).body,
    ).toEqual({ items: [], total: 2, page: 3, limit: 1 });
    expect(await snapshots()).toBe(before);
  });
  it('returns empty history and supports ADMIN ownership without extra privileges', async () => {
    const [user] = await fixture.accounts(1, 'ADMIN');
    expect((await fixture.mine(user.token).expect(200)).body).toEqual({
      items: [],
      total: 0,
      page: 1,
      limit: 25,
    });
    await fixture.workshop();
    const booking = await fixture.reserve(user.token).expect(201);
    expect((await fixture.mine(user.token).expect(200)).body.items[0].id).toBe(
      booking.body.id,
    );
  });
  it.each(['disabled', 'revoked', 'expired'] as const)(
    'rejects history and cancellation after %s eligibility loss',
    async (kind) => {
      const [user] = await fixture.accounts();
      await fixture.workshop();
      const booking = await fixture.reserve(user.token).expect(201);
      if (kind === 'disabled')
        await fixture.database
          .getRepository(UserEntity)
          .update(user.id, { isEnabled: false });
      else
        await fixture.database
          .getRepository(AuthSessionEntity)
          .update(
            user.sessionId,
            kind === 'revoked'
              ? { revokedAt: new Date() }
              : { expiresAt: new Date(0) },
          );
      const before = await snapshots();
      for (const call of [
        fixture.mine(user.token),
        fixture.cancel(user.token, booking.body.id),
      ]) {
        const denied = await call.expect(401);
        expect(denied.body).toEqual({
          statusCode: 401,
          code: 'UNAUTHORIZED',
          message: 'Authentication required',
        });
        expect(denied.headers['www-authenticate']).toBe('Bearer');
      }
      expect(await snapshots()).toBe(before);
    },
  );
  it('rejects invalid counters without repairing state or touching historical results', async () => {
    const [user] = await fixture.accounts();
    await fixture.workshop();
    const booking = await fixture.reserve(user.token).expect(201);
    await fixture.database
      .getRepository(WorkshopEntity)
      .update('legacy-workshop', { reservedSeats: 0 });
    const before = await snapshots();
    expect(
      (await fixture.cancel(user.token, booking.body.id).expect(500)).body,
    ).toEqual({
      statusCode: 500,
      code: 'INTERNAL_ERROR',
      message: 'Unable to cancel booking',
    });
    expect(await snapshots()).toBe(before);
  });
  it.each(['update', 'decrement', 'commit'] as const)(
    'rolls back cancellation and seat release after %s failure',
    async (stage) => {
      const [user] = await fixture.accounts();
      await fixture.workshop();
      const booking = await fixture.reserve(user.token).expect(201);
      const before = await snapshots();
      const runner = fixture.database.createQueryRunner();
      const actual = fixture.database.createQueryRunner.bind(fixture.database);
      const fail = () => {
        throw new QueryFailedError(
          'hidden cancellation test',
          [],
          new Error('private failure'),
        );
      };
      if (stage === 'commit')
        vi.spyOn(runner, 'commitTransaction').mockImplementationOnce(fail);
      else vi.spyOn(runner.manager, stage).mockImplementationOnce(fail);
      const makeRunner = vi
        .spyOn(fixture.database, 'createQueryRunner')
        .mockImplementation((mode) =>
          mode === undefined ? runner : actual(mode),
        );
      try {
        const result = await fixture
          .cancel(user.token, booking.body.id)
          .expect(503);
        expect(result.body).toEqual({
          statusCode: 503,
          code: 'DATABASE_UNAVAILABLE',
          message: 'Database unavailable',
        });
      } finally {
        makeRunner.mockRestore();
        vi.restoreAllMocks();
        if (!runner.isReleased) await runner.release();
      }
      expect(await snapshots()).toBe(before);
      await fixture.cancel(user.token, booking.body.id).expect(200);
      expect(await reserved()).toBe(0);
    },
  );
  it('preserves remembered reservation business errors after cancellation frees a seat', async () => {
    const [owner, other] = await fixture.accounts(2);
    await fixture.workshop();
    const booking = await fixture.reserve(owner.token).expect(201);
    const key = randomUUID();
    const full = await fixture
      .reserve(other.token, {}, 'legacy-workshop', key)
      .expect(409);
    await fixture.cancel(owner.token, booking.body.id).expect(200);
    expect(
      (
        await fixture
          .reserve(other.token, {}, 'legacy-workshop', key)
          .expect(409)
      ).body,
    ).toEqual(full.body);
    await fixture.reserve(other.token).expect(201);
    expect(await reserved()).toBe(1);
  });
});
