import { ApiProperty } from '@nestjs/swagger';
import { BookingResponseDto } from './booking.dto.js';
import { WorkshopResponseDto } from '../workshops/workshop-response.dto.js';

export class MyBookingDto extends BookingResponseDto {
  @ApiProperty({ type: WorkshopResponseDto }) workshop: WorkshopResponseDto;
}
export class MyBookingPageDto {
  @ApiProperty({ type: [MyBookingDto] }) items: MyBookingDto[];
  @ApiProperty({ example: 1 }) total: number;
  @ApiProperty({ example: 1 }) page: number;
  @ApiProperty({ example: 25 }) limit: number;
}
