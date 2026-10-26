import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { AdminController } from './admin.controller.js';
import { AdminWorkshopsController } from './admin-workshops.controller.js';
import { AdminWorkshopsService } from './admin-workshops.service.js';

@Module({
  imports: [AuthModule],
  controllers: [AdminController, AdminWorkshopsController],
  providers: [AdminWorkshopsService],
})
export class AdminModule {}
