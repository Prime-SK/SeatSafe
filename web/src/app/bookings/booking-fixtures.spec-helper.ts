import { BookingItem } from './booking';
export function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    key: (index) => [...values.keys()][index] ?? null,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
  };
}
export const bookingFixture: BookingItem = {
  id: 'booking-one',
  workshopId: 'legacy/id',
  status: 'ACTIVE',
  createdAt: '2030-01-01T00:00:00Z',
  cancelledAt: null,
  workshop: {
    id: 'legacy/id',
    title: 'Workshop',
    capacity: 1,
    reservedSeats: 1,
    availableSeats: 0,
    registrationOpen: true,
    startsAt: '2040-01-01T10:00:00Z',
  },
};
