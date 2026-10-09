import { ApiProperty } from '@nestjs/swagger';
import type { WorkshopResponse } from './workshop.types.js';

// Runtime documentation metadata; the service still returns plain objects.
export class WorkshopResponseDto implements WorkshopResponse {
  @ApiProperty({
    type: String,
    example: 'workshop-1',
    description: 'Workshop ID.',
  })
  readonly id: string;

  @ApiProperty({ type: String, example: 'NestJS basics' })
  readonly title: string;

  @ApiProperty({
    type: Number,
    example: 20,
    description: 'Total seat capacity.',
  })
  readonly capacity: number;

  @ApiProperty({
    type: Number,
    example: 0,
    description: 'Reserved seat count.',
  })
  readonly reservedSeats: number;

  @ApiProperty({ type: Boolean, example: true })
  readonly registrationOpen: boolean;

  @ApiProperty({
    type: Number,
    example: 20,
    description:
      'Capacity minus reserved seats; closed workshops can still have available seats.',
  })
  readonly availableSeats: number;
}
