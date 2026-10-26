import { Test } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types.js';
import { vi } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { WorkshopEntity } from '../src/workshops/workshop.entity.js';
import { createWorkshopFixtures } from './workshop-fixtures.js';
import { UserEntity } from '../src/users/user.entity.js';
import { PasswordHasher } from '../src/auth/password-hasher.js';
import { AuthSessionEntity } from '../src/auth/auth-session.entity.js';
import { AuthRefreshTokenEntity } from '../src/auth/auth-refresh-token.entity.js';

export async function createTestApp() {
  const loginQuery = {
    addSelect: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    getOne: vi.fn().mockResolvedValue(null),
  };
  const lockedQuery = {
    setLock: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    getOne: vi.fn().mockResolvedValue(null),
  };
  const sessionQuery = {
    innerJoinAndSelect: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    andWhere: vi.fn().mockReturnThis(),
    getOne: vi.fn().mockResolvedValue(null),
  };
  const sessionRepository = {
    insert: vi.fn().mockResolvedValue({}),
    createQueryBuilder: vi.fn().mockReturnValue(sessionQuery),
  };
  const credentialQuery = {
    innerJoinAndSelect: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    getOne: vi.fn().mockResolvedValue(null),
  };
  const refreshRepository = {
    insert: vi.fn().mockResolvedValue({}),
    createQueryBuilder: vi.fn().mockReturnValue(credentialQuery),
  };
  const manager = {
    getRepository: vi
      .fn()
      .mockImplementation((entity: unknown) =>
        entity === AuthRefreshTokenEntity
          ? refreshRepository
          : entity === AuthSessionEntity
            ? sessionRepository
            : { createQueryBuilder: () => lockedQuery },
      ),
  };
  const userRepository = {
    insert: vi.fn().mockResolvedValue({}),
    createQueryBuilder: vi.fn().mockReturnValue(loginQuery),
  };
  const passwordHasher = {
    hash: vi.fn().mockResolvedValue('test-only-hash'),
    verify: vi.fn().mockResolvedValue(false),
  };
  const records = createWorkshopFixtures();
  const workshopRepository = {
    find: vi.fn().mockResolvedValue(records),
    findOneBy: vi
      .fn()
      .mockImplementation(
        async ({ id }: { id: string }) =>
          records.find((record) => record.id === id) ?? null,
      ),
  };
  const database = {
    options: { type: 'postgres' },
    manager: {},
    isInitialized: true,
    query: vi.fn().mockResolvedValue([{ '?column?': 1 }]),
    transaction: vi
      .fn()
      .mockImplementation(
        async (work: (value: typeof manager) => Promise<unknown>) =>
          work(manager),
      ),
    destroy: vi.fn().mockResolvedValue(undefined),
  };
  database.destroy.mockImplementation(async () => {
    database.isInitialized = false;
  });
  const moduleFixture = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(getDataSourceToken())
    .useValue(database)
    .overrideProvider(getRepositoryToken(WorkshopEntity))
    .useValue(workshopRepository)
    .overrideProvider(getRepositoryToken(UserEntity))
    .useValue(userRepository)
    .overrideProvider(getRepositoryToken(AuthSessionEntity))
    .useValue(sessionRepository)
    .overrideProvider(PasswordHasher)
    .useValue(passwordHasher)
    .overrideProvider(getRepositoryToken(AuthRefreshTokenEntity))
    .useValue(refreshRepository)
    .compile();
  const app: INestApplication<App> = moduleFixture.createNestApplication();
  configureApp(app);
  await app.init();
  return {
    app,
    database,
    workshopRepository,
    userRepository,
    passwordHasher,
    loginQuery,
    lockedQuery,
    sessionRepository,
    sessionQuery,
    refreshRepository,
    credentialQuery,
  };
}
