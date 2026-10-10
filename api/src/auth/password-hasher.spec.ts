import { PasswordHasher } from './password-hasher.js';
import * as argon2 from 'argon2';

describe('PasswordHasher', () => {
  it('uses salted Argon2id with the specified costs and preserves the password', async () => {
    const hasher = new PasswordHasher();
    const password = '  Unicode 🔐 password  ';
    const first = await hasher.hash(password);
    const second = await hasher.hash(password);
    expect(first.split('$').slice(1, 3)).toEqual(['argon2id', 'v=19']);
    expect(first.split('$')[3].split(',').sort()).toEqual([
      'm=19456',
      'p=1',
      't=2',
    ]);
    expect(second).not.toBe(first);
    expect(await argon2.verify(first, password)).toBe(true);
    expect(await argon2.verify(first, password.trim())).toBe(false);
    expect(first).not.toContain(password);
    expect(await hasher.verify(first, password)).toBe(true);
    expect(await hasher.verify(first, password.trim())).toBe(false);
  });
  it('verifies the public dummy hash with the same costs and rejects malformed hashes', async () => {
    expect(PasswordHasher.dummyHash.split('$')[3].split(',').sort()).toEqual([
      'm=19456',
      'p=1',
      't=2',
    ]);
    expect(
      await new PasswordHasher().verify(PasswordHasher.dummyHash, 'wrong'),
    ).toBe(false);
    await expect(
      new PasswordHasher().verify('broken', 'password'),
    ).rejects.toThrow();
  });
});
