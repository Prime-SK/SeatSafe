import { vi } from 'vitest';
import type { DataSource } from 'typeorm';
import { seedAdminAccount } from './seed-admin-account.js';
import { PasswordHasher } from '../auth/password-hasher.js';

describe('Administrator seed failure boundaries', () => {
  afterEach(() => vi.restoreAllMocks());
  it.each([null, undefined, [], 'invalid', 10])(
    'rejects a non-object before opening a transaction: %j',
    async (input) => {
      const transaction = vi.fn();
      await expect(
        seedAdminAccount({ transaction } as unknown as DataSource, input),
      ).rejects.toThrow('Invalid administrator details');
      expect(transaction).not.toHaveBeenCalled();
    },
  );
  it('opens no transaction when password hashing fails', async () => {
    const transaction = vi.fn();
    vi.spyOn(PasswordHasher.prototype, 'hash').mockRejectedValue(
      new Error('hash unavailable'),
    );
    await expect(
      seedAdminAccount({ transaction } as unknown as DataSource, {
        displayName: 'Admin',
        email: 'admin@example.test',
        password: 'valid long test password',
      }),
    ).rejects.toThrow('hash unavailable');
    expect(transaction).not.toHaveBeenCalled();
  });
});
