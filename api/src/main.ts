import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import type { Environment } from './config/environment.js';
import { AppModule } from './app.module.js';
import { configureApp } from './app.setup.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  configureApp(app);
  const config = app.get(ConfigService<Environment, true>);
  const labEnabled =
    app.get(ConfigService).get<boolean>('RELIABILITY_LAB_ENABLED') === true;
  if (labEnabled)
    await app.listen(config.get('PORT', { infer: true }), '127.0.0.1');
  else await app.listen(config.get('PORT', { infer: true }));
  if (labEnabled && process.send) {
    let closing: Promise<void> | undefined;
    const close = () => {
      // A console interrupt and the launcher's IPC notice can arrive together.
      closing ??= app
        .close()
        .catch(() => {
          console.error('Reliability lab shutdown could not be completed');
          process.exitCode = 1;
        })
        .finally(() => {
          if (process.connected) process.disconnect();
        });
    };
    process.on('message', (message: unknown) => {
      if (message === 'seatsafe-lab-shutdown') close();
    });
    process.on('SIGINT', close);
    process.on('SIGTERM', close);
    // Closing the launcher also requests cleanup while this child is still alive.
    process.on('disconnect', close);
  } else app.enableShutdownHooks();
}
await bootstrap();
