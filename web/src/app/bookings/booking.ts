import { Workshop } from '../workshops/workshop';
export interface Booking {
  id: string;
  workshopId: string;
  status: 'ACTIVE' | 'CANCELLED';
  createdAt: string;
  cancelledAt: string | null;
}
export interface BookingItem extends Booking {
  workshop: Workshop;
}
export interface BookingPage {
  items: BookingItem[];
  total: number;
  page: number;
  limit: number;
}
