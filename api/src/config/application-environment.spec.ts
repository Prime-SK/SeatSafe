import { validateApplicationEnvironment } from './application-environment.js';
import { validateEnvironment } from './environment.js';

describe('Application configuration', () => {
  const base = {
    DB_NAME: 'fixture',
    DB_USER: 'fixture',
    DB_PASSWORD: 'fixture',
  };
  it('retains the application secret exactly for ConfigService and later JWT validation', () => {
    const secret = ' public-test-secret-that-is-long-enough ';
    expect(
      validateApplicationEnvironment({ ...base, JWT_SECRET: secret })
        .JWT_SECRET,
    ).toBe(secret);
  });
  it('keeps JWT configuration optional in the database CLI validator', () => {
    expect(validateEnvironment(base)).not.toHaveProperty('JWT_SECRET');
    expect(validateApplicationEnvironment(base).JWT_SECRET).toBeUndefined();
  });
});
