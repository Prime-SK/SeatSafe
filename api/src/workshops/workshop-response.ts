import type { WorkshopEntity } from './workshop.entity.js';
import type { WorkshopResponse } from './workshop.types.js';

export function toWorkshopResponse(workshop: WorkshopEntity): WorkshopResponse {
  // Both public reads and administration expose exactly this contract.
  return {
    id: workshop.id,
    title: workshop.title,
    capacity: workshop.capacity,
    reservedSeats: workshop.reservedSeats,
    registrationOpen: workshop.registrationOpen,
    availableSeats: workshop.capacity - workshop.reservedSeats,
    startsAt: workshop.startsAt.toISOString(),
  };
}
