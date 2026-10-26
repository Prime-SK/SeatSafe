import { ApiProperty } from '@nestjs/swagger';

export class AccountSummaryDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ example: 'Sample learner' }) displayName: string;
  @ApiProperty({ example: 'learner@example.test', format: 'email' })
  email: string;
  @ApiProperty({ enum: ['USER', 'ADMIN'] }) role: 'USER' | 'ADMIN';
}
