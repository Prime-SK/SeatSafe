export interface Workshop {
  readonly id: string;
  readonly title: string;
  readonly capacity: number;
  readonly reservedSeats: number;
  readonly registrationOpen: boolean;
  readonly availableSeats: number;
  readonly startsAt: string;
}
