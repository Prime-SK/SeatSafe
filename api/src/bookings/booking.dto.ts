import { Injectable } from '@nestjs/common';
import type { PipeTransform } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsInt, IsUUID, Max, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { RegistrationError } from '../auth/registration-error.js';
import type { BookingStatus } from './booking.entity.js';

@Injectable()
export class EmptyBookingBody implements PipeTransform {
  transform(value: unknown): Record<string, never> {
    if (value === undefined) return {};
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      Object.keys(value).length
    ) {
      throw new RegistrationError(
        400,
        'VALIDATION_FAILED',
        'Invalid booking request',
        { body: ['Supply no body or an empty object'] },
      );
    }
    return {};
  }
}
const integer = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
export class BookingPageQuery {
  @Transform(integer) @IsInt() @Min(1) @Max(2147483647) page = 1;
  @Transform(integer) @IsInt() @Min(1) @Max(100) limit = 25;
}
export class BookingIdParams {
  @IsUUID() id: string;
}
export class BookingResponseDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ example: 'workshop-1' }) workshopId: string;
  @ApiProperty({ enum: ['ACTIVE', 'CANCELLED'] }) status: BookingStatus;
  @ApiProperty({ format: 'date-time' }) createdAt: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  cancelledAt: string | null;
}
export class BookingAttendeeDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() displayName: string;
  @ApiProperty() email: string;
}
export class AdminBookingDto extends BookingResponseDto {
  @ApiProperty({ type: BookingAttendeeDto }) user: BookingAttendeeDto;
}
export class BookingPageDto {
  @ApiProperty({ type: [AdminBookingDto] }) items: AdminBookingDto[];
  @ApiProperty() total: number;
  @ApiProperty() page: number;
  @ApiProperty() limit: number;
}
