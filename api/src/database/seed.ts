import { validateEnvironment } from '../config/environment.js';
import database from './data-source.js';
import { seedWorkshops } from './seed-workshops.js';

try {
  const environment = validateEnvironment(process.env);
  if (environment.NODE_ENV !== 'development') {
    throw new Error('The workshop seed command requires NODE_ENV=development.');
  }
  await database.initialize();
  if (await database.showMigrations()) {
    throw new Error(
      'Apply pending migrations with npm run db:migration:run before seeding.',
    );
  }
  const result = await seedWorkshops(database);
  console.log(
    `Workshop seed: ${result.inserted} inserted, ${result.skipped} skipped.`,
  );
} catch (error) {
  // Driver errors can contain query data; keep this CLI's output secret-safe.
  const message =
    error instanceof Error &&
    (error.message ===
      'The workshop seed command requires NODE_ENV=development.' ||
      error.message ===
        'Apply pending migrations with npm run db:migration:run before seeding.')
      ? error.message
      : 'Workshop seed failed. Check the database connection and applied migrations.';
  console.error(message);
  process.exitCode = 1;
} finally {
  if (database.isInitialized) {
    try {
      await database.destroy();
    } catch {
      console.error('Workshop seed connection cleanup failed.');
      process.exitCode = 1;
    }
  }
}
