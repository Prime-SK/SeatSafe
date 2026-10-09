import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { DataSource } from 'typeorm';
import { validateEnvironment } from '../config/environment.js';
import { createDatabaseOptions } from './database.options.js';

// The CLI runs without Nest, so it loads and validates the same settings itself.
config({
  path: fileURLToPath(new URL('../../.env', import.meta.url)),
  quiet: true,
});

export default new DataSource(
  createDatabaseOptions(validateEnvironment(process.env)),
);
