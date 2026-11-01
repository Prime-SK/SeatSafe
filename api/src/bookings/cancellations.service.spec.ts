import { DataSource, QueryFailedError } from 'typeorm';
import { BookingsService } from './bookings.service.js';
import { UserEntity } from '../users/user.entity.js';
import { AuthSessionEntity } from '../auth/auth-session.entity.js';
import { WorkshopEntity } from '../workshops/workshop.entity.js';
import { BookingEntity } from './booking.entity.js';

describe('Owned cancellation transaction and private history', () => {
  const principal = {
    id: 'owner',
    sessionId: 'session',
    displayName: 'Owner',
    email: 'o@example.test',
    role: 'USER' as const,
  };
  const chain = () => ({
    setLock: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    getOne: vi.fn(),
  });
  let user: ReturnType<typeof chain>;
  let workshop: ReturnType<typeof chain>;
  let booking: ReturnType<typeof chain>;
  let row: {
    id: string;
    userId: string;
    workshopId: string;
    status: 'ACTIVE' | 'CANCELLED';
    createdAt: Date;
    cancelledAt: Date | null;
  };
  let session: { findOneBy: ReturnType<typeof vi.fn> };
  let books: {
    findOneBy: ReturnType<typeof vi.fn>;
    createQueryBuilder: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  let workshops: {
    createQueryBuilder: ReturnType<typeof vi.fn>;
    decrement: ReturnType<typeof vi.fn>;
  };
  let manager: { getRepository: ReturnType<typeof vi.fn> };
  let database: { transaction: ReturnType<typeof vi.fn> };
  let service: BookingsService;
  beforeEach(() => {
    user = chain();
    workshop = chain();
    booking = chain();
    user.getOne.mockResolvedValue({ id: 'owner', isEnabled: true });
    workshop.getOne.mockResolvedValue({ id: 'opaque', reservedSeats: 1 });
    row = {
      id: 'booking',
      userId: 'owner',
      workshopId: 'opaque',
      status: 'ACTIVE',
      createdAt: new Date('2030-01-01T00:00:00Z'),
      cancelledAt: null,
    };
    booking.getOne.mockResolvedValue(row);
    session = {
      findOneBy: vi.fn().mockResolvedValue({
        revokedAt: null,
        expiresAt: new Date(Date.now() + 60000),
      }),
    };
    books = {
      findOneBy: vi.fn().mockResolvedValue(row),
      createQueryBuilder: vi.fn().mockReturnValue(booking),
      update: vi.fn().mockResolvedValue({ affected: 1 }),
    };
    workshops = {
      createQueryBuilder: vi.fn().mockReturnValue(workshop),
      decrement: vi.fn().mockResolvedValue({ affected: 1 }),
    };
    manager = {
      getRepository: vi
        .fn()
        .mockImplementation((entity) =>
          entity === UserEntity
            ? { createQueryBuilder: () => user }
            : entity === AuthSessionEntity
              ? session
              : entity === WorkshopEntity
                ? workshops
                : entity === BookingEntity
                  ? books
                  : null,
        ),
    };
    database = {
      transaction: vi
        .fn()
        .mockImplementation((work: (value: unknown) => unknown) =>
          work(manager),
        ),
    };
    service = new BookingsService(database as unknown as DataSource);
  });
  it('locks user then workshop then booking, scopes both reads to the owner and maps five fields', async () => {
    const response = await service.cancel(principal, 'booking');
    expect(books.findOneBy).toHaveBeenCalledWith({
      id: 'booking',
      userId: 'owner',
    });
    expect(booking.where).toHaveBeenCalledWith(expect.any(String), {
      id: 'booking',
      userId: 'owner',
    });
    for (const query of [user, workshop, booking])
      expect(query.setLock).toHaveBeenCalledWith('pessimistic_write');
    expect(user.getOne.mock.invocationCallOrder[0]).toBeLessThan(
      workshop.getOne.mock.invocationCallOrder[0],
    );
    expect(workshop.getOne.mock.invocationCallOrder[0]).toBeLessThan(
      booking.getOne.mock.invocationCallOrder[0],
    );
    expect(session.findOneBy).toHaveBeenCalledTimes(2);
    expect(response).toEqual({
      id: 'booking',
      workshopId: 'opaque',
      status: 'CANCELLED',
      createdAt: row.createdAt.toISOString(),
      cancelledAt: expect.any(String),
    });
    expect(workshops.decrement).toHaveBeenCalledWith(
      { id: 'opaque' },
      'reservedSeats',
      1,
    );
  });
  it('returns an existing cancellation timestamp without writes even with a zero counter', async () => {
    row.status = 'CANCELLED';
    row.cancelledAt = new Date('2030-02-01T00:00:00Z');
    workshop.getOne.mockResolvedValue({ id: 'opaque', reservedSeats: 0 });
    const result = await service.cancel(principal, 'booking');
    expect(result.cancelledAt).toBe(row.cancelledAt.toISOString());
    expect(books.update).not.toHaveBeenCalled();
    expect(workshops.decrement).not.toHaveBeenCalled();
  });
  it.each([
    'missing-user',
    'disabled',
    'missing-session',
    'revoked',
    'expired',
    'expired-after-wait',
  ] as const)('rejects %s before writes', async (kind) => {
    if (kind === 'missing-user') user.getOne.mockResolvedValue(null);
    if (kind === 'disabled')
      user.getOne.mockResolvedValue({ isEnabled: false });
    if (kind === 'missing-session') session.findOneBy.mockResolvedValue(null);
    if (kind === 'revoked')
      session.findOneBy.mockResolvedValue({
        revokedAt: new Date(),
        expiresAt: new Date(Date.now() + 60000),
      });
    if (kind === 'expired')
      session.findOneBy.mockResolvedValue({
        revokedAt: null,
        expiresAt: new Date(0),
      });
    if (kind === 'expired-after-wait')
      session.findOneBy
        .mockResolvedValueOnce({
          revokedAt: null,
          expiresAt: new Date(Date.now() + 60000),
        })
        .mockResolvedValueOnce({ revokedAt: null, expiresAt: new Date(0) });
    await expect(service.cancel(principal, 'booking')).rejects.toMatchObject({
      response: { code: 'UNAUTHORIZED' },
    });
    expect(books.update).not.toHaveBeenCalled();
    expect(workshops.decrement).not.toHaveBeenCalled();
  });
  it.each(['initial', 'locked'])(
    'returns the same not-found error for a missing owned %s read',
    async (stage) => {
      if (stage === 'initial') books.findOneBy.mockResolvedValue(null);
      else booking.getOne.mockResolvedValue(null);
      await expect(service.cancel(principal, 'booking')).rejects.toMatchObject({
        response: {
          statusCode: 404,
          code: 'BOOKING_NOT_FOUND',
          message: 'Booking not found',
        },
      });
      expect(workshops.decrement).not.toHaveBeenCalled();
    },
  );
  it.each([0, -1])(
    'rejects invalid ACTIVE counter %i without repair',
    async (reservedSeats) => {
      workshop.getOne.mockResolvedValue({ id: 'opaque', reservedSeats });
      await expect(service.cancel(principal, 'booking')).rejects.toMatchObject({
        response: {
          code: 'INTERNAL_ERROR',
          message: 'Unable to cancel booking',
        },
      });
      expect(books.update).not.toHaveBeenCalled();
    },
  );
  it.each(['missing', 'changed'])(
    'fails safely for %s linked workshop state',
    async (kind) => {
      workshop.getOne.mockResolvedValue(
        kind === 'missing' ? null : { id: 'other', reservedSeats: 1 },
      );
      await expect(service.cancel(principal, 'booking')).rejects.toMatchObject({
        response: { code: 'INTERNAL_ERROR' },
      });
    },
  );
  it('waits for commit before resolving and maps plain commit failure to 503', async () => {
    let commit!: () => void;
    const gate = new Promise<void>((resolve) => {
      commit = resolve;
    });
    database.transaction.mockImplementation(
      async (work: (value: unknown) => Promise<unknown>) => {
        await work(manager);
        await gate;
        throw new Error('private commit failure');
      },
    );
    let finished = false;
    const pending = service
      .cancel(principal, 'booking')
      .catch((error: unknown) => {
        finished = true;
        return error;
      });
    for (let turn = 0; turn < 20; turn++) await Promise.resolve();
    expect(finished).toBe(false);
    commit();
    expect(await pending).toMatchObject({
      response: { code: 'DATABASE_UNAVAILABLE' },
    });
  });
  it('hides database write details', async () => {
    books.update.mockRejectedValue(
      new QueryFailedError('private SQL', [], new Error('private error')),
    );
    await expect(service.cancel(principal, 'booking')).rejects.toMatchObject({
      response: {
        statusCode: 503,
        code: 'DATABASE_UNAVAILABLE',
        message: 'Database unavailable',
      },
    });
  });
  it('maps unexpected application failure to a safe cancellation 500', async () => {
    booking.getOne.mockResolvedValue({ ...row, createdAt: null });
    await expect(service.cancel(principal, 'booking')).rejects.toMatchObject({
      response: { code: 'INTERNAL_ERROR', message: 'Unable to cancel booking' },
    });
  });
  it('maps private-list connection failures to 503', async () => {
    const unavailable = new BookingsService({
      getRepository: () => {
        throw new Error('private connection');
      },
    } as unknown as DataSource);
    await expect(
      unavailable.mine(principal, { page: 1, limit: 25 }),
    ).rejects.toMatchObject({ response: { code: 'DATABASE_UNAVAILABLE' } });
  });
});
