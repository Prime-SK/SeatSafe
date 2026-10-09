import { ApiProperty } from '@nestjs/swagger';

export class HealthResponseDto {
  @ApiProperty({ type: String, enum: ['ok'], example: 'ok' })
  readonly status: 'ok';

  @ApiProperty({ type: String, enum: ['up'], example: 'up' })
  readonly database: 'up';
}
