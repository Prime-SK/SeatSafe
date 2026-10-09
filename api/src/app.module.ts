import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { WorkshopsModule } from './workshops/workshops.module.js';
import { ConfigurationModule } from './config/configuration.module.js';
import { DatabaseModule } from './database/database.module.js';
import { HealthModule } from './health/health.module.js';

@Module({
  imports: [ConfigurationModule, DatabaseModule, WorkshopsModule, HealthModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
