import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import type { Environment } from './config/environment.js';
import { AppModule } from './app.module.js';
import { configureApp } from './app.setup.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  configureApp(app);
  app.enableShutdownHooks();
  const config = app.get(ConfigService<Environment, true>);
  await app.listen(config.get('PORT', { infer: true }));
}
await bootstrap();
