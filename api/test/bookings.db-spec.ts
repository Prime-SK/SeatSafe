import { randomUUID } from 'node:crypto';
import { QueryFailedError } from 'typeorm';
import request from 'supertest';
import { bookingFixture } from './support/booking-fixture.js';
import type { BookingFixture } from './support/booking-fixture.js';
import { BookingEntity } from '../dist/bookings/booking.entity.js';
import { WorkshopEntity } from '../dist/workshops/workshop.entity.js';
import { UserEntity } from '../dist/users/user.entity.js';
import { AuthSessionEntity } from '../dist/auth/auth-session.entity.js';

describe('Reservation persistence and API with PostgreSQL', () => {
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
  it.each(['USER', 'ADMIN'] as const)(
    'reserves exactly one seat for %s and exposes five safe fields',
    async (role) => {
      const [account] = await fixture.accounts(1, role);
      await fixture.workshop();
      const result = await fixture.reserve(account.token).expect(201);
      expect(Object.keys(result.body).sort()).toEqual(
        ['id', 'workshopId', 'status', 'createdAt', 'cancelledAt'].sort(),
      );
      expect(result.body).toEqual({
        id: expect.any(String),
        workshopId: 'legacy-workshop',
        status: 'ACTIVE',
        createdAt: expect.any(String),
        cancelledAt: null,
      });
      expect(result.headers['cache-control']).toBe('no-store');
      expect(result.headers['set-cookie']).toBeUndefined();
      expect(
        await fixture.database
          .getRepository(BookingEntity)
          .findOneByOrFail({ id: result.body.id }),
      ).toMatchObject({ userId: account.id, status: 'ACTIVE' });
      expect(
        await fixture.database
          .getRepository(WorkshopEntity)
          .findOneByOrFail({ id: 'legacy-workshop' }),
      ).toMatchObject({ reservedSeats: 1 });
      expect(
        (await fixture.reserve(account.token, {}).expect(409)).body.code,
      ).toBe('ALREADY_BOOKED');
    },
  );
  it.each([
    { userId: randomUUID() },
    { quantity: 2 },
    { status: 'CANCELLED' },
    { workshopId: 'other' },
    [],
    null,
    true,
    4,
    'text',
  ])('rejects unsupported reservation body %j', async (body) => {
    const [account] = await fixture.accounts();
    await fixture.workshop();
    const result = await fixture.reserve(account.token, body).expect(400);
    expect(result.body.code).toBe('VALIDATION_FAILED');
    expect(result.headers['cache-control']).toBe('no-store');
    expect(await fixture.database.getRepository(BookingEntity).count()).toBe(0);
  });
  it('rejects malformed JSON safely and accepts an empty JSON object', async () => {
    const [account] = await fixture.accounts();
    await fixture.workshop();
    const invalid = await request(fixture.app.getHttpServer())
      .post('/api/workshops/legacy-workshop/bookings')
      .set('Authorization', `Bearer ${account.token}`)
      .set('Content-Type', 'application/json')
      .send('{')
      .expect(400);
    expect(invalid.body).toMatchObject({
      code: 'VALIDATION_FAILED',
      message: 'Invalid booking request',
    });
    expect(invalid.headers['cache-control']).toBe('no-store');
    await fixture.reserve(account.token, {}).expect(201);
  });
  it.each(['disabled', 'revoked', 'expired'] as const)(
    'rejects %s accounts/sessions uniformly',
    async (kind) => {
      const [account] = await fixture.accounts();
      await fixture.workshop();
      if (kind === 'disabled')
        await fixture.database
          .getRepository(UserEntity)
          .update(account.id, { isEnabled: false });
      else
        await fixture.database
          .getRepository(AuthSessionEntity)
          .update(
            account.sessionId,
            kind === 'revoked'
              ? { revokedAt: new Date() }
              : { expiresAt: new Date(Date.now() - 1) },
          );
      const result = await fixture.reserve(account.token).expect(401);
      expect(result.body).toEqual({
        statusCode: 401,
        code: 'UNAUTHORIZED',
        message: 'Authentication required',
      });
      expect(result.headers['www-authenticate']).toBe('Bearer');
      expect(await fixture.database.getRepository(BookingEntity).count()).toBe(
        0,
      );
    },
  );
  it.each(['closed', 'started', 'full', 'missing'] as const)(
    'handles %s workshop without a booking or counter change',
    async (kind) => {
      const [account] = await fixture.accounts();
      if (kind !== 'missing')
        await fixture.workshop(
          kind === 'closed'
            ? { registrationOpen: false }
            : kind === 'started'
              ? { startsAt: new Date(Date.now() - 1) }
              : { reservedSeats: 1 },
        );
      const result = await fixture
        .reserve(account.token)
        .expect(kind === 'missing' ? 404 : 409);
      expect(result.body.code).toBe(
        {
          closed: 'REGISTRATION_CLOSED',
          started: 'WORKSHOP_ALREADY_STARTED',
          full: 'WORKSHOP_FULL',
          missing: 'WORKSHOP_NOT_FOUND',
        }[kind],
      );
      expect(await fixture.database.getRepository(BookingEntity).count()).toBe(
        0,
      );
    },
  );
  it('lists current profiles, all statuses and stable pagination without private fields', async () => {
    const users = await fixture.accounts(3);
    const [admin] = await fixture.accounts(1, 'ADMIN');
    await fixture.workshop({ capacity: 5 });
    for (const user of users) await fixture.reserve(user.token).expect(201);
    await fixture.database.getRepository(UserEntity).update(users[0].id, {
      displayName: 'Current attendee',
      email: 'current@example.test',
      isEnabled: false,
    });
    const rows = await fixture.database
      .getRepository(BookingEntity)
      .find({ order: { createdAt: 'ASC', id: 'ASC' } });
    await fixture.database
      .getRepository(BookingEntity)
      .update(rows[1].id, { status: 'CANCELLED', cancelledAt: new Date() });
    await fixture.database
      .getRepository(WorkshopEntity)
      .decrement({ id: 'legacy-workshop' }, 'reservedSeats', 1);
    const page = await fixture.list(admin.token, '?page=1&limit=2').expect(200);
    expect(page.body).toMatchObject({ total: 3, page: 1, limit: 2 });
    expect(page.body.items.map((row: { id: string }) => row.id)).toEqual(
      rows.slice(0, 2).map((row) => row.id),
    );
    expect(page.body.items[0].user).toEqual({
      id: users[0].id,
      displayName: 'Current attendee',
      email: 'current@example.test',
    });
    expect(page.body.items[1].status).toBe('CANCELLED');
    expect(Object.keys(page.body.items[0]).sort()).toEqual(
      ['id', 'workshopId', 'status', 'createdAt', 'cancelledAt', 'user'].sort(),
    );
    expect(
      (await fixture.list(admin.token, '?page=2&limit=2').expect(200)).body
        .items,
    ).toHaveLength(1);
    expect(
      (await fixture.list(admin.token, '?page=9').expect(200)).body,
    ).toEqual({ items: [], total: 3, page: 9, limit: 25 });
    expect((await fixture.list(users[1].token).expect(403)).body.code).toBe(
      'FORBIDDEN',
    );
  });
  it('uses current ADMIN role and distinguishes empty from missing workshops', async () => {
    const [account] = await fixture.accounts();
    await fixture.workshop();
    await fixture.list(account.token).expect(403);
    await fixture.database
      .getRepository(UserEntity)
      .update(account.id, { role: 'ADMIN' });
    expect((await fixture.list(account.token).expect(200)).body).toEqual({
      items: [],
      total: 0,
      page: 1,
      limit: 25,
    });
    await fixture.list(account.token, '', 'unknown').expect(404);
    await fixture.database
      .getRepository(UserEntity)
      .update(account.id, { role: 'USER' });
    await fixture.list(account.token).expect(403);
  });
  it.each([
    '?page=0',
    '?page=-1',
    '?page=1.2',
    '?limit=101',
    '?limit=0',
    '?limit=no',
    '?page=1&page=2',
    '?userId=other',
    '?page=1e2',
  ])('rejects invalid pagination %s', async (query) => {
    const [admin] = await fixture.accounts(1, 'ADMIN');
    await fixture.workshop();
    const result = await fixture.list(admin.token, query).expect(400);
    expect(result.body.message).toBe('Invalid booking query');
  });
  it('enforces foreign keys, status checks, cancellation consistency and partial active uniqueness', async () => {
    const [user] = await fixture.accounts();
    await fixture.workshop({ capacity: 5 });
    const repository = fixture.database.getRepository(BookingEntity);
    const row = {
      userId: user.id,
      workshopId: 'legacy-workshop',
      status: 'ACTIVE' as const,
      cancelledAt: null,
    };
    const insert = (overrides: object) =>
      repository.insert({ ...row, id: randomUUID(), ...overrides });
    await insert({});
    await expect(insert({})).rejects.toMatchObject({
      driverError: {
        code: '23505',
        constraint: 'UQ_bookings_active_user_workshop',
      },
    });
    await expect(insert({ userId: randomUUID() })).rejects.toMatchObject({
      driverError: { code: '23503' },
    });
    await expect(insert({ workshopId: 'unknown' })).rejects.toMatchObject({
      driverError: { code: '23503' },
    });
    await expect(insert({ status: 'OTHER' })).rejects.toMatchObject({
      driverError: { code: '23514' },
    });
    await expect(insert({ status: 'CANCELLED' })).rejects.toMatchObject({
      driverError: { code: '23514' },
    });
    await expect(insert({ cancelledAt: new Date() })).rejects.toMatchObject({
      driverError: { code: '23514' },
    });
    await insert({ status: 'CANCELLED', cancelledAt: new Date() });
    await insert({ status: 'CANCELLED', cancelledAt: new Date() });
    await expect(
      fixture.database.getRepository(UserEntity).delete(user.id),
    ).rejects.toMatchObject({ driverError: { code: '23503' } });
    await expect(
      fixture.database.getRepository(WorkshopEntity).delete('legacy-workshop'),
    ).rejects.toMatchObject({ driverError: { code: '23503' } });
  });
  it('reverses/reapplies the fifth migration preserving accounts/workshops and entity agreement', async () => {
    await fixture.accounts();
    await fixture.workshop();
    const users = await fixture.database.getRepository(UserEntity).find();
    const workshops = await fixture.database
      .getRepository(WorkshopEntity)
      .find();
    await fixture.database.undoLastMigration();
    expect(
      (await fixture.database.runMigrations()).map((row) => row.name),
    ).toEqual(['CreateBookings1793491200000']);
    expect(await fixture.database.getRepository(UserEntity).find()).toEqual(
      users,
    );
    expect(await fixture.database.getRepository(WorkshopEntity).find()).toEqual(
      workshops,
    );
    expect(await fixture.database.getRepository(BookingEntity).count()).toBe(0);
    expect(
      (await fixture.database.driver.createSchemaBuilder().log()).upQueries,
    ).toEqual([]);
    const runner = fixture.database.createQueryRunner();
    try {
      const table = await runner.getTable(`${fixture.schema}.bookings`);
      expect(
        table?.foreignKeys.every(
          (key) =>
            key.referencedSchema === fixture.schema &&
            key.onDelete === 'NO ACTION',
        ),
      ).toBe(true);
    } finally {
      await runner.release();
    }
  });
  it.each(['insert', 'increment', 'commit'] as const)(
    'rolls back booking and counter after %s failure',
    async (stage) => {
      const [account] = await fixture.accounts();
      await fixture.workshop();
      const runner = fixture.database.createQueryRunner();
      const actual = fixture.database.createQueryRunner.bind(fixture.database);
      const failure =
        stage === 'commit'
          ? vi
              .spyOn(runner, 'commitTransaction')
              .mockRejectedValueOnce(
                new QueryFailedError(
                  'COMMIT',
                  [],
                  new Error('Injected commit failure'),
                ),
              )
          : vi
              .spyOn(runner.manager, stage)
              .mockRejectedValueOnce(
                new QueryFailedError(
                  'write',
                  [],
                  new Error('Injected write failure'),
                ),
              );
      // TypeORM's repository delegates increment to its transaction manager.
      const makeRunner = vi
        .spyOn(fixture.database, 'createQueryRunner')
        .mockImplementation((mode) =>
          mode === undefined ? runner : actual(mode),
        );
      try {
        await fixture.reserve(account.token).expect(503);
        expect(
          await fixture.database.getRepository(BookingEntity).count(),
        ).toBe(0);
        expect(
          (
            await fixture.database
              .getRepository(WorkshopEntity)
              .findOneByOrFail({ id: 'legacy-workshop' })
          ).reservedSeats,
        ).toBe(0);
      } finally {
        failure.mockRestore();
        makeRunner.mockRestore();
        if (!runner.isReleased) await runner.release();
      }
    },
  );
});
