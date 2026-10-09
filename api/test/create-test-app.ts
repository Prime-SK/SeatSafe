import { Test } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types.js';
import { vi } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { WorkshopEntity } from '../src/workshops/workshop.entity.js';
import { createWorkshopFixtures } from './workshop-fixtures.js';

export async function createTestApp() {
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
    .compile();
  const app: INestApplication<App> = moduleFixture.createNestApplication();
  configureApp(app);
  await app.init();
  return { app, database, workshopRepository };
}
