import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { QueryFailedError } from 'typeorm';
import { AuthService } from './auth.service.js';
import { PasswordHasher } from './password-hasher.js';
import { UserEntity } from '../users/user.entity.js';

describe('AuthService', () => {
  const input = {
    displayName: 'Learner',
    email: 'learner@example.test',
    password: '  exact password remains  ',
  };
  let service: AuthService;
  let repository: { insert: ReturnType<typeof vi.fn> };
  let hasher: { hash: ReturnType<typeof vi.fn> };
  beforeEach(async () => {
    repository = { insert: vi.fn().mockResolvedValue({}) };
    hasher = { hash: vi.fn().mockResolvedValue('encoded-hash') };
    const module = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: getRepositoryToken(UserEntity), useValue: repository },
        { provide: PasswordHasher, useValue: hasher },
      ],
    }).compile();
    service = module.get(AuthService);
  });
  it('inserts exactly once and exposes only the four safe user fields', async () => {
    const result = await service.register(input);
    expect(hasher.hash).toHaveBeenCalledExactlyOnceWith(input.password);
    expect(repository.insert).toHaveBeenCalledExactlyOnceWith({
      ...result,
      passwordHash: 'encoded-hash',
      isEnabled: true,
    });
    expect(result).toEqual({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      displayName: input.displayName,
      email: input.email,
      role: 'USER',
    });
    expect(Object.keys(result)).toEqual(['id', 'displayName', 'email', 'role']);
  });
  it('maps only the named email uniqueness violation to conflict', async () => {
    repository.insert.mockRejectedValue(
      new QueryFailedError(
        'private SQL',
        [],
        Object.assign(new Error('private detail'), {
          code: '23505',
          constraint: 'UQ_users_email',
        }),
      ),
    );
    await expect(service.register(input)).rejects.toMatchObject({
      response: { statusCode: 409, code: 'EMAIL_ALREADY_EXISTS' },
    });
  });
  it('does not mislabel another unique constraint as duplicate email', async () => {
    repository.insert.mockRejectedValue(
      new QueryFailedError(
        'private SQL',
        [],
        Object.assign(new Error(), { code: '23505', constraint: 'PK_users' }),
      ),
    );
    await expect(service.register(input)).rejects.toMatchObject({
      response: {
        statusCode: 503,
        code: 'DATABASE_UNAVAILABLE',
        message: 'Database unavailable',
      },
    });
  });
  it('sanitizes repository failures', async () => {
    repository.insert.mockRejectedValue(
      new Error('private connection details'),
    );
    await expect(service.register(input)).rejects.toMatchObject({
      response: {
        statusCode: 503,
        code: 'DATABASE_UNAVAILABLE',
        message: 'Database unavailable',
      },
    });
  });
  it('does not insert when hashing fails and returns a safe internal error', async () => {
    hasher.hash.mockRejectedValue(new Error('private native detail'));
    await expect(service.register(input)).rejects.toMatchObject({
      response: {
        statusCode: 500,
        code: 'INTERNAL_ERROR',
        message: 'Unable to create account',
      },
    });
    expect(repository.insert).not.toHaveBeenCalled();
  });
});
