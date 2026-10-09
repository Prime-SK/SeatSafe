import { validateEnvironment } from './environment.js';

const credentials = {
  DB_NAME: 'seatsafe_test',
  DB_USER: 'test_user',
  DB_PASSWORD: 'test-password',
};

describe('Environment validation', () => {
  it.each(['DB_NAME', 'DB_USER', 'DB_PASSWORD'])(
    'rejects an absent %s',
    (key) => {
      expect(() =>
        validateEnvironment({ ...credentials, [key]: undefined }),
      ).toThrow(key);
    },
  );
  it('provides defaults while requiring database credentials', () => {
    expect(validateEnvironment(credentials)).toEqual({
      ...credentials,
      NODE_ENV: 'development',
      PORT: 3000,
      DB_HOST: 'localhost',
      DB_PORT: 5432,
    });
  });

  it('converts decimal port strings and keeps the password exactly', () => {
    expect(
      validateEnvironment({
        ...credentials,
        PORT: ' 4000 ',
        DB_PORT: '5544',
        DB_PASSWORD: '  exact-password  ',
      }),
    ).toMatchObject({
      PORT: 4000,
      DB_PORT: 5544,
      DB_PASSWORD: '  exact-password  ',
    });
  });

  it.each(['0', '65536', '-1', '3.14', '3e3', 'abc', '', ' ', Infinity, null])(
    'rejects an invalid API port: %s',
    (value) => {
      // null is not a process.env value; it must not silently become a default.
      expect(() =>
        validateEnvironment({ ...credentials, PORT: value }),
      ).toThrow('PORT');
    },
  );

  it.each(['DB_NAME', 'DB_USER', 'DB_PASSWORD'])(
    'requires %s without echoing values',
    (key) => {
      expect(() => validateEnvironment({ ...credentials, [key]: ' ' })).toThrow(
        key,
      );
    },
  );

  it('reports multiple invalid keys and never includes submitted values', () => {
    expect(() =>
      validateEnvironment({
        ...credentials,
        PORT: 'private-port-marker',
        NODE_ENV: 'private-environment-marker',
        DB_PASSWORD: 'private-password-marker',
      }),
    ).toThrow('PORT');
    try {
      validateEnvironment({
        ...credentials,
        DB_NAME: '',
        PORT: 'private-port-marker',
        DB_PASSWORD: 'private-password-marker',
      });
      throw new Error('Expected validation to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).not.toContain('private-port-marker');
      expect((error as Error).message).not.toContain('private-password-marker');
      expect((error as Error).message).toContain('DB_NAME');
      expect((error as Error).message).toContain('PORT');
    }
  });

  it.each(['development', 'test', 'production'])(
    'accepts NODE_ENV=%s',
    (value) => {
      expect(
        validateEnvironment({ ...credentials, NODE_ENV: value }).NODE_ENV,
      ).toBe(value);
    },
  );

  it('rejects a nonnumeric database port and a blank host', () => {
    expect(() =>
      validateEnvironment({ ...credentials, DB_PORT: 'bad', DB_HOST: '' }),
    ).toThrow('DB_PORT');
  });
});
