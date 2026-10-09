import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { fileURLToPath } from 'node:url';
import { validateEnvironment } from './environment.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: fileURLToPath(new URL('../../.env', import.meta.url)),
      // HTTP tests supply explicit fixture settings and never read local secrets.
      ignoreEnvFile: process.env.NODE_ENV === 'test',
      validate: validateEnvironment,
    }),
  ],
})
export class ConfigurationModule {}
