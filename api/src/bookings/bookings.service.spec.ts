import { DataSource, QueryFailedError } from 'typeorm';
import { BookingsService } from './bookings.service.js';
import { UserEntity } from '../users/user.entity.js';
import { WorkshopEntity } from '../workshops/workshop.entity.js';
import { AuthSessionEntity } from '../auth/auth-session.entity.js';
import { BookingEntity } from './booking.entity.js';
describe('Booking transaction decisions', () => {
  const principal = {
    id: 'user',
    sessionId: 'session',
    displayName: 'Learner',
    email: 'u@example.test',
    role: 'USER' as const,
  };
  const workshop = () => ({
    id: 'opaque',
    capacity: 1,
    reservedSeats: 0,
    registrationOpen: true,
    startsAt: new Date(Date.now() + 60000),
  });
  const query = () => ({
    setLock: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    getOne: vi.fn(),
  });
  let service: BookingsService;
  let userQuery: ReturnType<typeof query>;
  let workshopQuery: ReturnType<typeof query>;
  let session: { findOneBy: ReturnType<typeof vi.fn> };
  let bookings: {
    existsBy: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    insert: ReturnType<typeof vi.fn>;
  };
  let workshops: {
    createQueryBuilder: ReturnType<typeof vi.fn>;
    increment: ReturnType<typeof vi.fn>;
  };
  let database: { transaction: ReturnType<typeof vi.fn> };
  let manager: { getRepository: ReturnType<typeof vi.fn> };
  beforeEach(() => {
    userQuery = query();
    userQuery.getOne.mockResolvedValue({ id: 'user', isEnabled: true });
    workshopQuery = query();
    workshopQuery.getOne.mockResolvedValue(workshop());
    session = {
      findOneBy: vi.fn().mockResolvedValue({
        revokedAt: null,
        expiresAt: new Date(Date.now() + 60000),
      }),
    };
    bookings = {
      existsBy: vi.fn().mockResolvedValue(false),
      create: vi.fn().mockImplementation((row: object) => ({
        ...row,
        createdAt: new Date(),
      })),
      insert: vi.fn().mockResolvedValue({}),
    };
    workshops = {
      createQueryBuilder: vi.fn().mockReturnValue(workshopQuery),
      increment: vi.fn().mockResolvedValue({}),
    };
    manager = {
      getRepository: vi
        .fn()
        .mockImplementation((entity: unknown) =>
          entity === UserEntity
            ? { createQueryBuilder: () => userQuery }
            : entity === AuthSessionEntity
              ? session
              : entity === WorkshopEntity
                ? workshops
                : entity === BookingEntity
                  ? bookings
                  : null,
        ),
    };
    database = {
      transaction: vi
        .fn()
        .mockImplementation((work: (manager: unknown) => unknown) =>
          work(manager),
        ),
    };
    service = new BookingsService(database as unknown as DataSource);
  });
  it('locks user before workshop and uses only the transaction manager', async () => {
    const result = await service.reserve(principal, 'opaque');
    expect(userQuery.setLock).toHaveBeenCalledWith('pessimistic_write');
    expect(workshopQuery.setLock).toHaveBeenCalledWith('pessimistic_write');
    expect(userQuery.getOne.mock.invocationCallOrder[0]).toBeLessThan(
      workshopQuery.getOne.mock.invocationCallOrder[0],
    );
    expect(session.findOneBy).toHaveBeenCalledTimes(2);
    expect(bookings.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user',
        workshopId: 'opaque',
        status: 'ACTIVE',
      }),
    );
    expect(workshops.increment).toHaveBeenCalledWith(
      { id: 'opaque' },
      'reservedSeats',
      1,
    );
    expect(Object.keys(result).sort()).toEqual(
      ['id', 'workshopId', 'status', 'createdAt', 'cancelledAt'].sort(),
    );
  });
  it('does not return a response until transaction commit resolves', async () => {
    let commit!: () => void;
    const gate = new Promise<void>((resolve) => (commit = resolve));
    database.transaction.mockImplementation(
      async (work: (manager: unknown) => Promise<unknown>) => {
        const result = await work(manager);
        await gate;
        return result;
      },
    );
    let finished = false;
    const pending = service
      .reserve(principal, 'opaque')
      .then(() => (finished = true));
    for (let turn = 0; turn < 12; turn++) await Promise.resolve();
    expect(finished).toBe(false);
    commit();
    await pending;
    expect(finished).toBe(true);
  });
  it('checks duplicate before closed, started or full status', async () => {
    bookings.existsBy.mockResolvedValue(true);
    workshopQuery.getOne.mockResolvedValue({
      ...workshop(),
      registrationOpen: false,
      reservedSeats: 1,
      startsAt: new Date(0),
    });
    await expect(service.reserve(principal, 'opaque')).rejects.toMatchObject({
      response: { code: 'ALREADY_BOOKED' },
    });
    expect(bookings.insert).not.toHaveBeenCalled();
  });
  it.each([
    'missing-user',
    'disabled',
    'missing-session',
    'revoked',
    'expired',
    'expires-after-lock',
  ] as const)('rejects %s before writing', async (kind) => {
    if (kind === 'missing-user') userQuery.getOne.mockResolvedValue(null);
    if (kind === 'disabled')
      userQuery.getOne.mockResolvedValue({ id: 'user', isEnabled: false });
    if (kind === 'missing-session') session.findOneBy.mockResolvedValue(null);
    if (kind === 'revoked')
      session.findOneBy.mockResolvedValue({
        revokedAt: new Date(),
        expiresAt: new Date(Date.now() + 60000),
      });
    if (kind === 'expired')
      session.findOneBy.mockResolvedValue({
        revokedAt: null,
        expiresAt: new Date(Date.now() - 1),
      });
    if (kind === 'expires-after-lock')
      session.findOneBy
        .mockResolvedValueOnce({
          revokedAt: null,
          expiresAt: new Date(Date.now() + 60000),
        })
        .mockResolvedValueOnce({ revokedAt: null, expiresAt: new Date(0) });
    await expect(service.reserve(principal, 'opaque')).rejects.toMatchObject({
      response: { code: 'UNAUTHORIZED', message: 'Authentication required' },
    });
    expect(bookings.insert).not.toHaveBeenCalled();
  });
  it.each([
    ['missing', 'WORKSHOP_NOT_FOUND'],
    ['closed', 'REGISTRATION_CLOSED'],
    ['started', 'WORKSHOP_ALREADY_STARTED'],
    ['full', 'WORKSHOP_FULL'],
  ])('handles %s workshops safely', async (kind, code) => {
    workshopQuery.getOne.mockResolvedValue(
      kind === 'missing'
        ? null
        : {
            ...workshop(),
            ...(kind === 'closed'
              ? { registrationOpen: false }
              : kind === 'started'
                ? { startsAt: new Date(0) }
                : { reservedSeats: 1 }),
          },
    );
    await expect(service.reserve(principal, 'opaque')).rejects.toMatchObject({
      response: { code },
    });
    expect(workshops.increment).not.toHaveBeenCalled();
  });
  it.each([
    ['23505', 'UQ_bookings_active_user_workshop', 'ALREADY_BOOKED'],
    ['08006', 'other', 'DATABASE_UNAVAILABLE'],
  ])(
    'maps database failure %s without raw details',
    async (code, constraint, expected) => {
      database.transaction.mockRejectedValue(
        new QueryFailedError(
          'private SQL',
          [],
          Object.assign(new Error('private database detail'), {
            code,
            constraint,
          }),
        ),
      );
      const error = await service
        .reserve(principal, 'opaque')
        .catch((failure: unknown) => failure);
      expect(error).toMatchObject({ response: { code: expected } });
      expect(JSON.stringify(error)).not.toContain('private database detail');
    },
  );
  it('returns safe 500 for unexpected application failures', async () => {
    bookings.create.mockImplementation(() => {
      throw new Error('private internal detail');
    });
    await expect(service.reserve(principal, 'opaque')).rejects.toMatchObject({
      response: { code: 'INTERNAL_ERROR', message: 'Unable to reserve seat' },
    });
  });
  it.each(['connect', 'commit'])(
    'maps plain %s failures at the transaction boundary to safe 503',
    async (stage) => {
      database.transaction.mockImplementation(
        async (work: (manager: unknown) => Promise<unknown>) => {
          if (stage === 'commit') await work(manager);
          throw new Error('private connection/commit detail');
        },
      );
      await expect(service.reserve(principal, 'opaque')).rejects.toMatchObject({
        response: {
          code: 'DATABASE_UNAVAILABLE',
          message: 'Database unavailable',
        },
      });
    },
  );
  it('maps an administrator list acquisition failure to 503', async () => {
    const unavailable = new BookingsService({
      getRepository: () => {
        throw new Error('private pool detail');
      },
    } as unknown as DataSource);
    await expect(
      unavailable.list('opaque', { page: 1, limit: 25 }),
    ).rejects.toMatchObject({ response: { code: 'DATABASE_UNAVAILABLE' } });
  });
});
