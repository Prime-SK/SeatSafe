import { validateEnvironment } from '../config/environment.js';
import database from './data-source.js';
import { AdminSeedError, seedAdminAccount } from './seed-admin-account.js';
import { promptAdminAccount } from './admin-seed-prompt.js';

try {
  if (process.argv.length !== 2)
    throw new AdminSeedError(
      'Administrator seed accepts no command-line arguments.',
    );
  if (validateEnvironment(process.env).NODE_ENV !== 'development')
    throw new AdminSeedError(
      'The administrator seed command requires NODE_ENV=development.',
    );
  await database.initialize();
  if (await database.showMigrations())
    throw new AdminSeedError(
      'Apply pending migrations before seeding an administrator.',
    );
  const input = await promptAdminAccount();
  try {
    const result = await seedAdminAccount(database, input);
    console.log(`Administrator seed: ${result}.`);
  } finally {
    input.password = '';
  }
} catch (error) {
  console.error(
    error instanceof AdminSeedError
      ? error.message
      : 'Administrator seed failed. Check the database connection and applied migrations.',
  );
  process.exitCode = 1;
} finally {
  if (database.isInitialized) {
    try {
      await database.destroy();
    } catch {
      console.error(
        'Administrator seed could not close the database connection.',
      );
      process.exitCode = 1;
    }
  }
}
