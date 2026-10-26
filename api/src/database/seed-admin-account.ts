import { randomUUID } from 'node:crypto';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import type { DataSource } from 'typeorm';
import { RegisterDto } from '../auth/register.dto.js';
import { PasswordHasher } from '../auth/password-hasher.js';
import { UserEntity } from '../users/user.entity.js';

export class AdminSeedError extends Error {}

export async function seedAdminAccount(
  database: DataSource,
  input: unknown,
): Promise<'inserted' | 'skipped'> {
  if (typeof input !== 'object' || input === null || Array.isArray(input))
    throw new AdminSeedError(
      'Invalid administrator details. Use the registration name, email and password rules.',
    );
  const account = plainToInstance(RegisterDto, input);
  if (
    !account ||
    Array.isArray(account) ||
    validateSync(account, { whitelist: true, forbidNonWhitelisted: true })
      .length > 0
  )
    throw new AdminSeedError(
      'Invalid administrator details. Use the registration name, email and password rules.',
    );
  const passwordHash = await new PasswordHasher().hash(account.password);
  return database.transaction(async (manager) => {
    const repository = manager.getRepository(UserEntity);
    const result = await repository
      .createQueryBuilder()
      .insert()
      .into(UserEntity)
      .values({
        id: randomUUID(),
        displayName: account.displayName,
        email: account.email,
        passwordHash,
        role: 'ADMIN',
        isEnabled: true,
      })
      .onConflict('("email") DO NOTHING')
      .returning('id')
      .execute();
    if ((result.raw as { id: string }[]).length === 1) return 'inserted';
    // ON CONFLICT waits for a competing insert. The next statement sees its committed row.
    const existing = await repository
      .createQueryBuilder('user')
      .setLock('pessimistic_write')
      .where('user.email = :email', { email: account.email })
      .getOne();
    if (existing?.role === 'ADMIN' && existing.isEnabled) return 'skipped';
    throw new AdminSeedError(
      'Administrator seed conflict: the email belongs to a user or disabled account. No account was changed.',
    );
  });
}
