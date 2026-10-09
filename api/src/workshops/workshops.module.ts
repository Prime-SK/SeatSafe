import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WorkshopEntity } from './workshop.entity.js';
import { WorkshopsController } from './workshops.controller.js';
import { WorkshopsService } from './workshops.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([WorkshopEntity])],
  controllers: [WorkshopsController],
  providers: [WorkshopsService],
})
export class WorkshopsModule {}
