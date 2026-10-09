import type { DataSource } from 'typeorm';
import { WorkshopEntity } from '../workshops/workshop.entity.js';

export interface WorkshopSeedResult {
  inserted: number;
  skipped: number;
}

export async function seedWorkshops(
  database: DataSource,
  now = new Date(),
): Promise<WorkshopSeedResult> {
  if (!database.isInitialized) {
    throw new Error('Initialize the database before seeding workshops.');
  }
  if (!Number.isFinite(now.getTime())) {
    throw new Error('The workshop seed requires a valid date.');
  }

  // Compute dates from one UTC calendar date, independent of the host timezone.
  function startsAt(days: number): Date {
    return new Date(
      Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate() + days,
        10,
      ),
    );
  }
  const records = [
    {
      id: 'workshop-1',
      title: 'NestJS basics',
      capacity: 20,
      reservedSeats: 0,
      registrationOpen: true,
      startsAt: startsAt(7),
    },
    {
      id: 'workshop-2',
      title: 'Angular reactive forms',
      capacity: 10,
      reservedSeats: 0,
      registrationOpen: false,
      startsAt: startsAt(14),
    },
    {
      id: 'workshop-3',
      title: 'PostgreSQL transactions',
      capacity: 12,
      reservedSeats: 0,
      registrationOpen: true,
      startsAt: startsAt(21),
    },
  ];

  return database.transaction(async (manager) => {
    // INSERT ... ON CONFLICT DO NOTHING preserves existing rows, including dates.
    const result = await manager
      .createQueryBuilder()
      .insert()
      .into(WorkshopEntity)
      .values(records)
      .orIgnore()
      .returning('id')
      .execute();
    const inserted = (result.raw as { id: string }[]).length;
    return { inserted, skipped: records.length - inserted };
  });
}
