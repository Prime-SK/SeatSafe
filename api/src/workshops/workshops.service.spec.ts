import { WorkshopsService } from './workshops.service.js';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { WorkshopEntity } from './workshop.entity.js';
import { createWorkshopFixtures } from '../../test/workshop-fixtures.js';
import { ServiceUnavailableException } from '@nestjs/common';

describe('WorkshopsService', () => {
  let service: WorkshopsService;
  let repository: {
    find: ReturnType<typeof vi.fn>;
    findOneBy: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    const records = createWorkshopFixtures();
    repository = {
      find: vi.fn().mockResolvedValue(records),
      findOneBy: vi
        .fn()
        .mockImplementation(
          async ({ id }: { id: string }) =>
            records.find((record) => record.id === id) ?? null,
        ),
    };
    const module = await Test.createTestingModule({
      providers: [
        WorkshopsService,
        { provide: getRepositoryToken(WorkshopEntity), useValue: repository },
      ],
    }).compile();
    service = module.get(WorkshopsService);
  });

  it('lists open, closed, and sold-out workshops with calculated seats', async () => {
    const workshops = await service.findAll();

    expect(repository.find).toHaveBeenCalledExactlyOnceWith({
      order: { startsAt: 'ASC', id: 'ASC' },
    });

    expect(workshops).toHaveLength(3);
    expect(workshops).toEqual([
      expect.objectContaining({
        id: 'workshop-1',
        availableSeats: 3,
        registrationOpen: true,
      }),
      expect.objectContaining({
        id: 'workshop-2',
        availableSeats: 8,
        registrationOpen: false,
      }),
      expect.objectContaining({
        id: 'workshop-3',
        availableSeats: 0,
        registrationOpen: true,
      }),
    ]);
  });

  it('finds the workshop matching the supplied ID', async () => {
    await expect(service.findById('workshop-1')).resolves.toEqual({
      id: 'workshop-1',
      title: 'NestJS basics',
      capacity: 20,
      reservedSeats: 17,
      registrationOpen: true,
      availableSeats: 3,
    });
    expect(repository.findOneBy).toHaveBeenCalledExactlyOnceWith({
      id: 'workshop-1',
    });
  });

  it('returns undefined for an unknown ID', async () => {
    await expect(service.findById('unknown')).resolves.toBeUndefined();
    expect(repository.findOneBy).toHaveBeenCalledExactlyOnceWith({
      id: 'unknown',
    });
  });

  it('returns separate objects for list and detail lookups', async () => {
    const firstList = await service.findAll();
    const secondList = await service.findAll();
    const firstDetail = await service.findById('workshop-1');
    const secondDetail = await service.findById('workshop-1');

    expect(firstList).not.toBe(secondList);
    expect(firstList[0]).not.toBe(secondList[0]);
    expect(firstDetail).not.toBe(secondDetail);
    expect(firstList[0]).not.toBe(firstDetail);
    expect(firstDetail).toEqual(secondDetail);
  });

  it('returns an empty array when no workshops are stored', async () => {
    repository.find.mockResolvedValueOnce([]);
    await expect(service.findAll()).resolves.toEqual([]);
  });

  it('exposes only the six response fields, without entity timestamps', async () => {
    const response = await service.findById('workshop-1');
    expect(Object.keys(response!)).toEqual([
      'id',
      'title',
      'capacity',
      'reservedSeats',
      'registrationOpen',
      'availableSeats',
    ]);
    expect(response).not.toBeInstanceOf(WorkshopEntity);
  });

  it.each(['list', 'detail'])(
    'sanitizes a rejected %s query',
    async (operation) => {
      const query =
        operation === 'list' ? repository.find : repository.findOneBy;
      query.mockRejectedValueOnce(
        new Error('private SQL and connection details'),
      );
      const request =
        operation === 'list'
          ? service.findAll()
          : service.findById('workshop-1');
      await expect(request).rejects.toBeInstanceOf(ServiceUnavailableException);
      await expect(request).rejects.toMatchObject({
        message: 'Database unavailable',
      });
    },
  );
});
