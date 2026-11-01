import { validateApplicationEnvironment } from './application-environment.js';
import { validateEnvironment } from './environment.js';

describe('Application configuration', () => {
  const base = {
    DB_NAME: 'fixture',
    DB_USER: 'fixture',
    DB_PASSWORD: 'fixture',
  };
  it('keeps the lab disabled by default and independent from migration configuration', () => {
    expect(validateApplicationEnvironment(base).RELIABILITY_LAB_ENABLED).toBe(
      false,
    );
    expect(
      validateEnvironment({ ...base, RELIABILITY_LAB_ENABLED: 'invalid' }),
    ).not.toHaveProperty('RELIABILITY_LAB_ENABLED');
    expect(
      validateApplicationEnvironment({
        ...base,
        DB_NAME: 'seatsafe_dev',
        RELIABILITY_LAB_ENABLED: 'true',
      }).RELIABILITY_LAB_ENABLED,
    ).toBe(true);
  });
  it.each([true, 'TRUE', '1', '', null])(
    'rejects non-strict lab flags %s',
    (value) => {
      expect(() =>
        validateApplicationEnvironment({
          ...base,
          RELIABILITY_LAB_ENABLED: value,
        }),
      ).toThrow('RELIABILITY_LAB_ENABLED');
    },
  );
  it.each([
    { NODE_ENV: 'production' },
    { NODE_ENV: 'test' },
    { DB_HOST: 'remote.example.test' },
    { DB_NAME: 'another_database' },
  ])('refuses enabled lab for incompatible settings %j', (change) => {
    expect(() =>
      validateApplicationEnvironment({
        ...base,
        DB_NAME: 'seatsafe_dev',
        RELIABILITY_LAB_ENABLED: 'true',
        ...change,
      }),
    ).toThrow('Reliability lab requires');
  });
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
  it('defaults to local Angular and the configured API port', () => {
    expect(
      validateApplicationEnvironment({ ...base, PORT: '3102' })
        .AUTH_ALLOWED_ORIGINS,
    ).toEqual(['http://localhost:4200', 'http://localhost:3102']);
  });
  it.each([
    '*',
    '',
    'null',
    'https://user:pass@example.test',
    'https://example.test/',
    'https://example.test/path',
    'https://example.test?x=1',
    'https://example.test#x',
    'file:///tmp',
    'https://example.test,',
  ])('rejects unsafe origin configuration without echoing it: %s', (value) => {
    expect(() =>
      validateApplicationEnvironment({ ...base, AUTH_ALLOWED_ORIGINS: value }),
    ).toThrow('AUTH_ALLOWED_ORIGINS');
  });
  it('requires explicit HTTPS production origins without affecting migration validation', () => {
    expect(() =>
      validateApplicationEnvironment({ ...base, NODE_ENV: 'production' }),
    ).toThrow('AUTH_ALLOWED_ORIGINS');
    expect(() =>
      validateApplicationEnvironment({
        ...base,
        NODE_ENV: 'production',
        AUTH_ALLOWED_ORIGINS: 'http://example.test',
      }),
    ).toThrow('AUTH_ALLOWED_ORIGINS');
    expect(
      validateApplicationEnvironment({
        ...base,
        NODE_ENV: 'production',
        AUTH_ALLOWED_ORIGINS: 'https://example.test',
      }).AUTH_ALLOWED_ORIGINS,
    ).toEqual(['https://example.test']);
    expect(
      validateEnvironment({
        ...base,
        NODE_ENV: 'production',
        AUTH_ALLOWED_ORIGINS: '*',
      }),
    ).not.toHaveProperty('AUTH_ALLOWED_ORIGINS');
  });
});
