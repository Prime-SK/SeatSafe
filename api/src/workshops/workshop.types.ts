export interface Workshop {
  readonly id: string;
  readonly title: string;
  readonly capacity: number;
  readonly reservedSeats: number;
  readonly registrationOpen: boolean;
}

export interface WorkshopResponse extends Workshop {
  readonly availableSeats: number;
}
