import { validateEnvironment } from '../config/environment.js';
import { validateApplicationEnvironment } from '../config/application-environment.js';
import { createDatabaseOptions } from '../database/database.options.js';
const base = {
  DB_NAME: 'fixture',
  DB_USER: 'fixture',
  DB_PASSWORD: 'public-fixture',
};
describe('Production release configuration', () => {
  it('requires verified TLS without requiring JWT for database commands', () => {
    const environment = validateEnvironment({
      ...base,
      NODE_ENV: 'production',
    });
    expect(createDatabaseOptions(environment).ssl).toEqual({
      rejectUnauthorized: true,
    });
    expect(() =>
      validateEnvironment({ ...base, NODE_ENV: 'production', DB_SSL: 'false' }),
    ).toThrow('DB_SSL');
    expect(environment).not.toHaveProperty('JWT_SECRET');
  });
  it.each(['TRUE', '1', '', true, null])(
    'rejects ambiguous database TLS flag %j',
    (value) => {
      expect(() => validateEnvironment({ ...base, DB_SSL: value })).toThrow(
        'DB_SSL',
      );
    },
  );
  it.each(['true', '-1', '1.5', '6', null])(
    'rejects unsafe proxy hops %j',
    (value) => {
      expect(() =>
        validateApplicationEnvironment({ ...base, TRUST_PROXY_HOPS: value }),
      ).toThrow('TRUST_PROXY_HOPS');
    },
  );
  it('keeps proxy trust off locally and permits a bounded explicit Render chain', () => {
    expect(validateApplicationEnvironment(base).TRUST_PROXY_HOPS).toBe(0);
    expect(
      validateApplicationEnvironment({ ...base, TRUST_PROXY_HOPS: '3' })
        .TRUST_PROXY_HOPS,
    ).toBe(3);
  });
});
