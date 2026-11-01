import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { AdminController } from './admin.controller.js';
import { AdminWorkshopsController } from './admin-workshops.controller.js';
import { AdminWorkshopsService } from './admin-workshops.service.js';
import { AdminUsersController } from './admin-users.controller.js';
import { AdminUsersService } from './admin-users.service.js';

@Module({
  imports: [AuthModule],
  controllers: [
    AdminController,
    AdminWorkshopsController,
    AdminUsersController,
  ],
  providers: [AdminWorkshopsService, AdminUsersService],
})
export class AdminModule {}
