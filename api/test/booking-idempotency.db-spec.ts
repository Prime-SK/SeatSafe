import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { JwtService } from '@nestjs/jwt';
import { QueryFailedError } from 'typeorm';
import { bookingFixture } from './support/booking-fixture.js';
import type { BookingFixture } from './support/booking-fixture.js';
import { BookingIdempotencyEntity } from '../dist/bookings/booking-idempotency.entity.js';
import { BookingEntity } from '../dist/bookings/booking.entity.js';
import { WorkshopEntity } from '../dist/workshops/workshop.entity.js';
import { UserEntity } from '../dist/users/user.entity.js';
import { AuthSessionEntity } from '../dist/auth/auth-session.entity.js';
import { bookingFingerprint } from '../dist/bookings/idempotency-key.js';

describe('Account-scoped reservation idempotency with PostgreSQL', () => {
  let fixture: BookingFixture;
  const records = () =>
    fixture.database.getRepository(BookingIdempotencyEntity);
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
  async function counts(bookings: number, outcomes: number) {
    expect(await fixture.database.getRepository(BookingEntity).count()).toBe(
      bookings,
    );
    expect(await records().count()).toBe(outcomes);
    expect(
      (
        await fixture.database
          .getRepository(WorkshopEntity)
          .findOneByOrFail({ id: 'legacy-workshop' })
      ).reservedSeats,
    ).toBe(bookings);
  }
  it('recovers a committed result after its caller discards the response, with no-body/{} equivalence', async () => {
    const [user] = await fixture.accounts();
    await fixture.workshop();
    const key = randomUUID();
    await fixture
      .reserve(user.token, undefined, 'legacy-workshop', key)
      .expect(201);
    const saved = await records().findOneByOrFail({
      userId: user.id,
      requestKey: key,
    });
    const retry = await fixture
      .reserve(user.token, {}, 'legacy-workshop', key)
      .expect(201);
    expect(retry.body).toEqual(saved.response);
    expect(saved.fingerprint).toBe(bookingFingerprint('legacy-workshop'));
    expect(saved.httpStatus).toBe(201);
    expect(retry.headers['cache-control']).toBe('no-store');
    await counts(1, 1);
  });
  it('replays across sessions and ignores later workshop eligibility changes', async () => {
    const [user] = await fixture.accounts();
    await fixture.workshop();
    const key = randomUUID();
    const first = await fixture
      .reserve(user.token, {}, 'legacy-workshop', key)
      .expect(201);
    await fixture.database
      .getRepository(WorkshopEntity)
      .update('legacy-workshop', {
        registrationOpen: false,
        startsAt: new Date(0),
      });
    const sessionId = randomUUID();
    await fixture.database.getRepository(AuthSessionEntity).insert({
      id: sessionId,
      userId: user.id,
      expiresAt: new Date(Date.now() + 60000),
      revokedAt: null,
    });
    const token = fixture.app
      .get(JwtService)
      .sign(
        { sub: user.id, sid: sessionId },
        { algorithm: 'HS256', expiresIn: 900 },
      );
    expect(
      (
        await fixture
          .reserve(token, undefined, 'legacy-workshop', key)
          .expect(201)
      ).body,
    ).toEqual(first.body);
    await counts(1, 1);
  });
  it('rejects another workshop for a used key without replacing the original snapshot', async () => {
    const [user] = await fixture.accounts();
    await fixture.workshop();
    await fixture.workshop({ id: 'Legacy-workshop' });
    const key = randomUUID();
    const first = await fixture
      .reserve(user.token, {}, 'legacy-workshop', key)
      .expect(201);
    const mismatch = await fixture
      .reserve(user.token, {}, 'Legacy-workshop', key)
      .expect(409);
    expect(mismatch.body).toEqual({
      statusCode: 409,
      code: 'IDEMPOTENCY_KEY_CONFLICT',
      message: 'Request key was already used for another request',
    });
    expect(
      (
        await fixture
          .reserve(user.token, {}, 'legacy-workshop', key)
          .expect(201)
      ).body,
    ).toEqual(first.body);
    await counts(1, 1);
  });
  it('isolates the same key by account and treats key casing distinctly', async () => {
    const users = await fixture.accounts(2);
    await fixture.workshop({ capacity: 2 });
    const key = 'Case-Sensitive-Key-0001';
    for (const user of users)
      await fixture.reserve(user.token, {}, 'legacy-workshop', key).expect(201);
    expect(
      (
        await fixture
          .reserve(users[0].token, {}, 'legacy-workshop', key.toLowerCase())
          .expect(409)
      ).body.code,
    ).toBe('ALREADY_BOOKED');
    await counts(2, 3);
  });
  it('keeps a successful creation snapshot after later cancellation and rebooking', async () => {
    const [user] = await fixture.accounts();
    await fixture.workshop();
    const key = randomUUID();
    const first = await fixture
      .reserve(user.token, {}, 'legacy-workshop', key)
      .expect(201);
    // Future cancellation behavior is simulated only as isolated test data.
    await fixture.database
      .getRepository(BookingEntity)
      .update(first.body.id, { status: 'CANCELLED', cancelledAt: new Date() });
    await fixture.database
      .getRepository(WorkshopEntity)
      .update('legacy-workshop', { reservedSeats: 0 });
    const next = await fixture.reserve(user.token).expect(201);
    expect(next.body.id).not.toBe(first.body.id);
    expect(
      (
        await fixture
          .reserve(user.token, {}, 'legacy-workshop', key)
          .expect(201)
      ).body,
    ).toEqual(first.body);
    expect(await fixture.database.getRepository(BookingEntity).count()).toBe(2);
    expect(await records().count()).toBe(2);
    expect(
      (
        await fixture.database
          .getRepository(WorkshopEntity)
          .findOneByOrFail({ id: 'legacy-workshop' })
      ).reservedSeats,
    ).toBe(1);
  });
  it.each(['missing', 'closed', 'started', 'full', 'duplicate'] as const)(
    'remembers the %s business result after conditions change',
    async (kind) => {
      const [user] = await fixture.accounts();
      if (kind !== 'missing')
        await fixture.workshop({
          registrationOpen: kind !== 'closed',
          startsAt: new Date(kind === 'started' ? 0 : Date.now() + 86400000),
          capacity: kind === 'full' ? 1 : 2,
          reservedSeats: kind === 'full' ? 1 : 0,
        });
      if (kind === 'duplicate') await fixture.reserve(user.token).expect(201);
      const key = randomUUID();
      const first = await fixture
        .reserve(user.token, {}, 'legacy-workshop', key)
        .expect(kind === 'missing' ? 404 : 409);
      await fixture.workshop({ capacity: 3 });
      if (kind === 'duplicate') {
        // Simulate a future cancellation without adding its endpoint in this phase.
        await fixture.database
          .getRepository(BookingEntity)
          .update(
            { userId: user.id },
            { status: 'CANCELLED', cancelledAt: new Date() },
          );
      }
      expect(
        (
          await fixture
            .reserve(user.token, undefined, 'legacy-workshop', key)
            .expect(first.status)
        ).body,
      ).toEqual(first.body);
      expect(await records().count()).toBe(kind === 'duplicate' ? 2 : 1);
      await fixture.reserve(user.token).expect(201);
    },
  );
  it.each(['disabled', 'revoked', 'expired'] as const)(
    'does not replay after %s eligibility loss',
    async (kind) => {
      const [user] = await fixture.accounts();
      await fixture.workshop();
      const key = randomUUID();
      await fixture.reserve(user.token, {}, 'legacy-workshop', key).expect(201);
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
      const denied = await fixture
        .reserve(user.token, {}, 'legacy-workshop', key)
        .expect(401);
      expect(denied.headers['www-authenticate']).toBe('Bearer');
      await counts(1, 1);
    },
  );
  it('stores no outcome for invalid bodies or missing keys', async () => {
    const [user] = await fixture.accounts();
    await fixture.workshop();
    await fixture.reserve(user.token, { quantity: 1 }).expect(400);
    await request(fixture.app.getHttpServer())
      .post('/api/workshops/legacy-workshop/bookings')
      .set('Authorization', `Bearer ${user.token}`)
      .expect(400);
    await counts(0, 0);
  });
  it('serializes 20 identical concurrent HTTP requests into the original 201 response', async () => {
    const [user] = await fixture.accounts();
    await fixture.workshop();
    const key = randomUUID();
    const responses = await Promise.all(
      Array.from({ length: 20 }, () =>
        fixture
          .reserve(user.token, {}, 'legacy-workshop', key)
          .timeout({ deadline: 10000 })
          .expect(201),
      ),
    );
    for (const response of responses)
      expect(response.body).toEqual(responses[0].body);
    await counts(1, 1);
    console.info(
      'IDEMPOTENT HTTP reservations: requests=20 successes=20 distinctBookingIds=1 activeBookings=1 reservedSeats=1 records=1',
    );
  });
  it('serializes conflicting fingerprints: one new booking and one key conflict', async () => {
    const [user] = await fixture.accounts();
    await fixture.workshop();
    await fixture.workshop({ id: 'another-workshop' });
    const key = randomUUID();
    const responses = await Promise.all(
      ['legacy-workshop', 'another-workshop'].map((id) =>
        fixture.reserve(user.token, {}, id, key).then((response) => response),
      ),
    );
    expect(responses.map((row) => row.status).sort((a, b) => a - b)).toEqual([
      201, 409,
    ]);
    expect(responses.find((row) => row.status === 409)?.body.code).toBe(
      'IDEMPOTENCY_KEY_CONFLICT',
    );
    expect(await records().count()).toBe(1);
    expect(await fixture.database.getRepository(BookingEntity).count()).toBe(1);
  });
  it.each(['booking', 'increment', 'record', 'commit'] as const)(
    'rolls back all writes after %s failure and accepts a deliberate same-key retry',
    async (stage) => {
      const [user] = await fixture.accounts();
      await fixture.workshop();
      const key = randomUUID();
      const runner = fixture.database.createQueryRunner();
      const actual = fixture.database.createQueryRunner.bind(fixture.database);
      const fail = () => {
        throw new QueryFailedError(
          'hidden test write',
          [],
          new Error('hidden fixture failure'),
        );
      };
      const insert = runner.manager.insert.bind(runner.manager);
      if (stage === 'commit')
        vi.spyOn(runner, 'commitTransaction').mockImplementationOnce(fail);
      else if (stage === 'increment')
        vi.spyOn(runner.manager, 'increment').mockImplementationOnce(fail);
      else
        vi.spyOn(runner.manager, 'insert').mockImplementation(
          async (...args) => {
            if (
              args[0] ===
              (stage === 'booking' ? BookingEntity : BookingIdempotencyEntity)
            )
              return fail();
            return insert(...args);
          },
        );
      const makeRunner = vi
        .spyOn(fixture.database, 'createQueryRunner')
        .mockImplementation((mode) =>
          mode === undefined ? runner : actual(mode),
        );
      try {
        await fixture
          .reserve(user.token, {}, 'legacy-workshop', key)
          .expect(503);
      } finally {
        makeRunner.mockRestore();
        vi.restoreAllMocks();
        if (!runner.isReleased) await runner.release();
      }
      await counts(0, 0);
      await fixture.reserve(user.token, {}, 'legacy-workshop', key).expect(201);
      await counts(1, 1);
    },
  );
  it('enforces user/key uniqueness, foreign key, key/fingerprint, status and object-response checks', async () => {
    const [user] = await fixture.accounts();
    const value = {
      id: randomUUID(),
      userId: user.id,
      requestKey: randomUUID(),
      fingerprint: bookingFingerprint('opaque'),
      httpStatus: 404 as const,
      response: {
        statusCode: 404,
        code: 'WORKSHOP_NOT_FOUND',
        message: 'Workshop not found',
      },
    };
    await records().insert(value);
    await expect(
      records().insert({ ...value, id: randomUUID() }),
    ).rejects.toMatchObject({
      driverError: {
        code: '23505',
        constraint: 'UQ_booking_idempotency_user_key',
      },
    });
    await expect(
      records().insert({
        ...value,
        id: randomUUID(),
        requestKey: randomUUID(),
        userId: randomUUID(),
      }),
    ).rejects.toMatchObject({ driverError: { code: '23503' } });
    for (const change of [
      { requestKey: 'short' },
      { fingerprint: 'g'.repeat(64) },
      { httpStatus: 500 },
      { response: [] },
    ]) {
      await expect(
        records().insert({
          ...value,
          id: randomUUID(),
          requestKey: randomUUID(),
          ...change,
        } as unknown as BookingIdempotencyEntity),
      ).rejects.toMatchObject({ driverError: { code: '23514' } });
    }
    await expect(
      fixture.database.getRepository(UserEntity).delete(user.id),
    ).rejects.toMatchObject({ driverError: { code: '23503' } });
  });
  it('reverses/reapplies only the sixth migration and agrees with entity metadata', async () => {
    await fixture.accounts();
    await fixture.workshop();
    await fixture.database.undoLastMigration();
    expect(
      (await fixture.database.runMigrations()).map((row) => row.name),
    ).toEqual(['CreateBookingIdempotency1793577600000']);
    expect(await records().count()).toBe(0);
    expect(await fixture.database.getRepository(UserEntity).count()).toBe(1);
    expect(
      (await fixture.database.driver.createSchemaBuilder().log()).upQueries,
    ).toEqual([]);
  });
});
