import { WorkshopEntity } from '../src/workshops/workshop.entity.js';

// Test-only counts cover open, closed, and sold-out responses. Real seed counts are zero.
export function createWorkshopFixtures(): WorkshopEntity[] {
  return [
    {
      id: 'workshop-1',
      title: 'NestJS basics',
      capacity: 20,
      reservedSeats: 17,
      registrationOpen: true,
    },
    {
      id: 'workshop-2',
      title: 'Angular reactive forms',
      capacity: 10,
      reservedSeats: 2,
      registrationOpen: false,
    },
    {
      id: 'workshop-3',
      title: 'PostgreSQL transactions',
      capacity: 12,
      reservedSeats: 12,
      registrationOpen: true,
    },
  ].map((record, index) =>
    Object.assign(new WorkshopEntity(), record, {
      startsAt: new Date(Date.UTC(2026, 10, index + 1, 10)),
      createdAt: new Date('2026-10-10T10:00:00Z'),
      updatedAt: new Date('2026-10-10T10:00:00Z'),
    }),
  );
}
