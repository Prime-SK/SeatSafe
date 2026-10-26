import { vi } from 'vitest';
import type { DataSource } from 'typeorm';
import { AdminWorkshopsService } from './admin-workshops.service.js';

describe('Administrator workshop feature logic', () => {
  let row: {
    id: string;
    title: string;
    capacity: number;
    reservedSeats: number;
    registrationOpen: boolean;
    startsAt: Date;
  };
  const repository = {
    create: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    createQueryBuilder: vi.fn(),
  };
  const query = { setLock: vi.fn(), where: vi.fn(), getOne: vi.fn() };
  const database = { transaction: vi.fn() };
  let service: AdminWorkshopsService;
  const input = {
    title: 'Transactions',
    capacity: 20,
    startsAt: '2040-05-02T15:30:00+05:30',
  };
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2040-05-01T10:00:00Z'));
    row = {
      id: 'legacy-workshop',
      title: 'Existing',
      capacity: 10,
      reservedSeats: 4,
      registrationOpen: false,
      startsAt: new Date(input.startsAt),
    };
    repository.create.mockImplementation((value) => value);
    repository.insert.mockResolvedValue({});
    repository.update.mockResolvedValue({ affected: 1 });
    repository.createQueryBuilder.mockReturnValue(query);
    query.setLock.mockReturnValue(query);
    query.where.mockReturnValue(query);
    query.getOne.mockImplementation(async () => row);
    database.transaction.mockImplementation(async (work) =>
      work({ getRepository: () => repository }),
    );
    service = new AdminWorkshopsService(database as unknown as DataSource);
  });
  afterEach(() => vi.useRealTimers());
  it('generates an ID and inserts zero reservations with open registration by default', async () => {
    const result = await service.create(input);
    expect(result).toEqual({
      ...input,
      id: expect.any(String),
      reservedSeats: 0,
      availableSeats: 20,
      registrationOpen: true,
      startsAt: '2040-05-02T10:00:00.000Z',
    });
    expect(result.id).toMatch(/^[a-f0-9-]{36}$/);
    expect(repository.insert).toHaveBeenCalledWith(
      expect.objectContaining({ reservedSeats: 0, registrationOpen: true }),
    );
  });
  it('honors an explicitly closed creation', async () => {
    expect(
      (await service.create({ ...input, registrationOpen: false }))
        .registrationOpen,
    ).toBe(false);
  });
  it.each(['2040-05-01T10:00:00Z', '2040-05-01T09:59:59Z'])(
    'rejects creation at or before now: %s',
    async (startsAt) => {
      await expect(
        service.create({ ...input, startsAt }),
      ).rejects.toMatchObject({
        response: {
          statusCode: 400,
          code: 'VALIDATION_FAILED',
          fieldErrors: { startsAt: expect.any(Array) },
        },
      });
      expect(repository.insert).not.toHaveBeenCalled();
    },
  );
  it('rejects an empty update before opening a transaction', async () => {
    await expect(service.update(row.id, {})).rejects.toMatchObject({
      response: { statusCode: 400 },
    });
    expect(database.transaction).not.toHaveBeenCalled();
  });
  it('locks the opaque ID and preserves all omitted values', async () => {
    const result = await service.update(row.id, { title: 'Updated' });
    expect(query.setLock).toHaveBeenCalledWith('pessimistic_write');
    expect(query.where).toHaveBeenCalledWith('workshop.id = :id', {
      id: row.id,
    });
    expect(result).toMatchObject({
      title: 'Updated',
      capacity: 10,
      reservedSeats: 4,
      registrationOpen: false,
      availableSeats: 6,
    });
  });
  it('returns a safe missing-workshop response', async () => {
    query.getOne.mockResolvedValue(null);
    await expect(
      service.update('missing', { title: 'Updated' }),
    ).rejects.toMatchObject({
      response: { statusCode: 404, code: 'WORKSHOP_NOT_FOUND' },
    });
    expect(repository.update).not.toHaveBeenCalled();
  });
  it('allows capacity equal to reservations but rejects a lower capacity', async () => {
    expect((await service.update(row.id, { capacity: 4 })).availableSeats).toBe(
      0,
    );
    repository.update.mockClear();
    await expect(service.update(row.id, { capacity: 3 })).rejects.toMatchObject(
      { response: { statusCode: 409, code: 'CAPACITY_BELOW_RESERVED' } },
    );
    expect(repository.update).not.toHaveBeenCalled();
  });
  it('keeps past instants while editing or closing registration', async () => {
    row.startsAt = new Date('2039-01-01T10:00:00Z');
    expect(
      (
        await service.update(row.id, {
          title: 'Historical',
          startsAt: row.startsAt.toISOString(),
          registrationOpen: false,
        })
      ).startsAt,
    ).toBe(row.startsAt.toISOString());
  });
  it('rejects reopening a past workshop', async () => {
    row.startsAt = new Date('2039-01-01T10:00:00Z');
    await expect(
      service.update(row.id, { registrationOpen: true }),
    ).rejects.toMatchObject({
      response: { statusCode: 409, code: 'WORKSHOP_ALREADY_STARTED' },
    });
  });
  it('allows future rescheduling and opening together', async () => {
    row.startsAt = new Date('2039-01-01T10:00:00Z');
    expect(
      (
        await service.update(row.id, {
          startsAt: input.startsAt,
          registrationOpen: true,
        })
      ).registrationOpen,
    ).toBe(true);
  });
  it('rechecks the clock after waiting for a row lock', async () => {
    query.getOne.mockImplementation(async () => {
      vi.setSystemTime(new Date('2040-05-03T10:00:00Z'));
      return row;
    });
    await expect(
      service.update(row.id, { registrationOpen: true }),
    ).rejects.toMatchObject({ response: { code: 'WORKSHOP_ALREADY_STARTED' } });
    expect(repository.update).not.toHaveBeenCalled();
  });
  it('rejects a changed start that is not future', async () => {
    await expect(
      service.update(row.id, { startsAt: '2040-05-01T10:00:00Z' }),
    ).rejects.toMatchObject({ response: { code: 'VALIDATION_FAILED' } });
  });
  it.each(['insert', 'update'] as const)(
    'sanitizes database %s failure',
    async (operation) => {
      repository[operation].mockRejectedValue(new Error('private SQL details'));
      const pending =
        operation === 'insert'
          ? service.create(input)
          : service.update(row.id, { title: 'Updated' });
      await expect(pending).rejects.toMatchObject({
        response: {
          statusCode: 503,
          code: 'DATABASE_UNAVAILABLE',
          message: 'Database unavailable',
        },
      });
    },
  );
  it('does not resolve success before commit and sanitizes commit rejection', async () => {
    database.transaction.mockImplementation(async (work) => {
      await work({ getRepository: () => repository });
      throw new Error('commit failure');
    });
    await expect(service.create(input)).rejects.toMatchObject({
      response: { statusCode: 503 },
    });
  });
});
