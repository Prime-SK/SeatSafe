import { createInterface } from 'node:readline/promises';
import { validateEnvironment } from '../config/environment.js';
import database from './data-source.js';
import { AdminSeedError, seedAdminAccount } from './seed-admin-account.js';
import { promptAdminAccount } from './admin-seed-prompt.js';

try {
  if (process.argv.length !== 2)
    throw new AdminSeedError(
      'Production administrator bootstrap accepts no arguments.',
    );
  const environment = validateEnvironment(process.env);
  if (environment.NODE_ENV !== 'production' || !environment.DB_SSL)
    throw new AdminSeedError(
      'Production administrator bootstrap requires production mode and verified database TLS.',
    );
  if (!process.stdin.isTTY || !process.stdout.isTTY)
    throw new AdminSeedError(
      'Production administrator bootstrap requires an interactive terminal.',
    );
  const confirmation = createInterface({
    input: process.stdin,
    output: process.stdout,
    historySize: 0,
  });
  try {
    if (
      (await confirmation.question(
        'This creates an administrator in the configured production database. Type CREATE ADMIN to continue: ',
      )) !== 'CREATE ADMIN'
    )
      throw new AdminSeedError(
        'Administrator bootstrap cancelled. No account was created.',
      );
  } finally {
    confirmation.close();
  }
  await database.initialize();
  if (await database.showMigrations())
    throw new AdminSeedError(
      'Apply pending migrations before creating an administrator.',
    );
  const input = await promptAdminAccount();
  try {
    console.log(
      `Production administrator bootstrap: ${await seedAdminAccount(database, input)}.`,
    );
  } finally {
    input.password = '';
  }
} catch (error) {
  console.error(
    error instanceof AdminSeedError
      ? error.message
      : 'Production administrator bootstrap failed. Check configuration and applied migrations privately.',
  );
  process.exitCode = 1;
} finally {
  if (database.isInitialized) {
    try {
      await database.destroy();
    } catch {
      console.error('Production administrator connection cleanup failed.');
      process.exitCode = 1;
    }
  }
}
