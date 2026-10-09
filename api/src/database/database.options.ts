import type { DataSourceOptions } from 'typeorm';
import { fileURLToPath } from 'node:url';
import type { Environment } from '../config/environment.js';
import { WorkshopEntity } from '../workshops/workshop.entity.js';

export function createDatabaseOptions(
  environment: Environment,
): Extract<DataSourceOptions, { type: 'postgres' }> {
  return {
    type: 'postgres',
    host: environment.DB_HOST,
    port: environment.DB_PORT,
    database: environment.DB_NAME,
    username: environment.DB_USER,
    password: environment.DB_PASSWORD,
    ssl: false,
    connectTimeoutMS: 5000,
    extra: { query_timeout: 5000 },
    entities: [WorkshopEntity],
    migrations: [
      fileURLToPath(new URL('./migrations/*.js', import.meta.url)).replaceAll(
        '\\',
        '/',
      ),
    ],
    synchronize: false,
    migrationsRun: false,
    logging: false,
  };
}
