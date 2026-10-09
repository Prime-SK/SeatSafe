import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { Test } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types.js';
import request from 'supertest';
import configuredDatabase from '../dist/database/data-source.js';
import { WorkshopEntity } from '../dist/workshops/workshop.entity.js';
import { seedWorkshops } from '../dist/database/seed-workshops.js';

const schema = `seatsafe_test_${randomUUID().replaceAll('-', '')}`;

describe('Workshop HTTP reads (real PostgreSQL)', () => {
  let control: DataSource;
  let database: DataSource;
  let app: INestApplication<App>;
  let schemaCreated = false;

  beforeAll(async () => {
    const options = configuredDatabase.options;
    if (
      options.type !== 'postgres' ||
      options.database !== 'seatsafe_dev' ||
      !['development', 'test'].includes(process.env.NODE_ENV ?? '')
    ) {
      throw new Error(
        'Database tests require NODE_ENV=development or test and DB_NAME=seatsafe_dev.',
      );
    }
    control = new DataSource({ ...options, migrations: [] });
    await control.initialize();
    const runner = control.createQueryRunner();
    try {
      await runner.createSchema(schema, false);
      schemaCreated = true;
    } finally {
      await runner.release();
    }
    database = new DataSource({ ...options, schema, logging: false });
    await database.initialize();
    await database.runMigrations();

    // Load the compiled application after its environment was loaded by the CLI DataSource.
    const { AppModule } = await import('../dist/app.module.js');
    const { configureApp } = await import('../dist/app.setup.js');
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(getDataSourceToken())
      .useValue(database)
      .compile();
    app = module.createNestApplication();
    configureApp(app);
    await app.init();
  });

  beforeEach(async () => {
    await database.getRepository(WorkshopEntity).clear();
    await seedWorkshops(database, new Date('2026-10-10T10:00:00Z'));
  });

  afterAll(async () => {
    try {
      await app?.close();
    } finally {
      try {
        if (database?.isInitialized) await database.destroy();
      } finally {
        if (control?.isInitialized) {
          const runner = control.createQueryRunner();
          try {
            // Never remove any schema except the random namespace created above.
            if (schemaCreated) await runner.dropSchema(schema, true, true);
          } finally {
            await runner.release();
            await control.destroy();
          }
        }
      }
    }
  });

  it('lists the actual seed rows with zero reservations', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/workshops')
      .expect(200);
    expect(response.body).toEqual([
      {
        id: 'workshop-1',
        title: 'NestJS basics',
        capacity: 20,
        reservedSeats: 0,
        registrationOpen: true,
        availableSeats: 20,
      },
      {
        id: 'workshop-2',
        title: 'Angular reactive forms',
        capacity: 10,
        reservedSeats: 0,
        registrationOpen: false,
        availableSeats: 10,
      },
      {
        id: 'workshop-3',
        title: 'PostgreSQL transactions',
        capacity: 12,
        reservedSeats: 0,
        registrationOpen: true,
        availableSeats: 12,
      },
    ]);
  });

  it('reads detail from PostgreSQL with the same public shape', async () => {
    await request(app.getHttpServer())
      .get('/api/workshops/workshop-1')
      .expect(200)
      .expect({
        id: 'workshop-1',
        title: 'NestJS basics',
        capacity: 20,
        reservedSeats: 0,
        registrationOpen: true,
        availableSeats: 20,
      });
  });

  it('orders by start time and breaks equal-time ties by ID', async () => {
    const repository = database.getRepository(WorkshopEntity);
    await repository.update(['workshop-1', 'workshop-3'], {
      startsAt: new Date('2026-11-03T10:00:00Z'),
    });
    await repository.update('workshop-2', {
      startsAt: new Date('2026-11-01T10:00:00Z'),
    });
    const response = await request(app.getHttpServer())
      .get('/api/workshops')
      .expect(200);
    expect(response.body.map((row: { id: string }) => row.id)).toEqual([
      'workshop-2',
      'workshop-1',
      'workshop-3',
    ]);
  });

  it('reflects an edit on the next request without restarting or reseeding', async () => {
    await database
      .getRepository(WorkshopEntity)
      .update('workshop-1', {
        title: 'Changed stored title',
        reservedSeats: 4,
      });
    const response = await request(app.getHttpServer())
      .get('/api/workshops/workshop-1')
      .expect(200);
    expect(response.body).toMatchObject({
      title: 'Changed stored title',
      reservedSeats: 4,
      availableSeats: 16,
    });
  });

  it('returns an empty array when the test table has no rows', async () => {
    await database.getRepository(WorkshopEntity).clear();
    await request(app.getHttpServer())
      .get('/api/workshops')
      .expect(200)
      .expect([]);
  });

  it('keeps closed, sold-out, and past workshops visible', async () => {
    await database.getRepository(WorkshopEntity).update('workshop-1', {
      reservedSeats: 20,
      startsAt: new Date('2000-01-01T10:00:00Z'),
    });
    const response = await request(app.getHttpServer())
      .get('/api/workshops')
      .expect(200);
    expect(response.body).toHaveLength(3);
    expect(response.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'workshop-1', availableSeats: 0 }),
        expect.objectContaining({
          id: 'workshop-2',
          registrationOpen: false,
          availableSeats: 10,
        }),
      ]),
    );
  });

  it('returns the standard 404 for a missing stored ID', async () => {
    await request(app.getHttpServer())
      .get('/api/workshops/unknown')
      .expect(404)
      .expect({
        statusCode: 404,
        message: 'Workshop not found',
        error: 'Not Found',
      });
  });

  it('treats SQL-looking IDs as values, without matching other records', async () => {
    await request(app.getHttpServer())
      .get(`/api/workshops/${encodeURIComponent("' OR '1'='1")}`)
      .expect(404);
    expect(await database.getRepository(WorkshopEntity).count()).toBe(3);
  });

  it('never serializes persistence timestamps in list or detail responses', async () => {
    const list = await request(app.getHttpServer())
      .get('/api/workshops')
      .expect(200);
    const detail = await request(app.getHttpServer())
      .get('/api/workshops/workshop-1')
      .expect(200);
    for (const row of [...list.body, detail.body]) {
      expect(Object.keys(row)).toEqual([
        'id',
        'title',
        'capacity',
        'reservedSeats',
        'registrationOpen',
        'availableSeats',
      ]);
    }
  });
});
