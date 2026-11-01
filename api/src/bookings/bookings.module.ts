import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import {
  BookingsController,
  AdminBookingsController,
} from './bookings.controller.js';
import { BookingsService } from './bookings.service.js';
@Module({
  imports: [AuthModule],
  controllers: [BookingsController, AdminBookingsController],
  providers: [BookingsService],
})
export class BookingsModule {}
