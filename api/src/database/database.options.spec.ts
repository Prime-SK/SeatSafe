import { validateEnvironment } from '../config/environment.js';
import { createDatabaseOptions } from './database.options.js';

describe('Shared database options', () => {
  it('keeps schema changes explicit and uses bounded local connections', () => {
    const options = createDatabaseOptions(
      validateEnvironment({
        DB_NAME: 'test_db',
        DB_USER: 'test_role',
        DB_PASSWORD: 'test-password',
      }),
    );
    expect(options).toMatchObject({
      type: 'postgres',
      database: 'test_db',
      username: 'test_role',
      ssl: false,
      synchronize: false,
      migrationsRun: false,
      connectTimeoutMS: 5000,
    });
  });
});
