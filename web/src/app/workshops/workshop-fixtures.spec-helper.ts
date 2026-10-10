import { Workshop } from './workshop';
export const workshopFixtures: Workshop[] = [
  {
    id: 'workshop-2',
    title: 'Closed workshop',
    capacity: 10,
    reservedSeats: 2,
    registrationOpen: false,
    availableSeats: 8,
    startsAt: '2026-10-16T10:00:00.000Z',
  },
  {
    id: 'workshop-1',
    title: 'Open workshop',
    capacity: 20,
    reservedSeats: 0,
    registrationOpen: true,
    availableSeats: 20,
    startsAt: '2026-10-16T10:00:00.000Z',
  },
  {
    id: 'workshop-3',
    title: 'Sold-out workshop',
    capacity: 12,
    reservedSeats: 12,
    registrationOpen: true,
    availableSeats: 0,
    startsAt: '2026-10-16T10:00:00.000Z',
  },
];
