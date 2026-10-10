import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { DataSource } from 'typeorm';
import configuredDatabase from '../dist/database/data-source.js';
import { seedWorkshops } from '../dist/database/seed-workshops.js';
import { WorkshopEntity } from '../dist/workshops/workshop.entity.js';
import { CreateWorkshops1791590400000 } from '../dist/database/migrations/1791590400000-CreateWorkshops.js';

const schema = `seatsafe_test_${randomUUID().replaceAll('-', '')}`;
const tablePath = `${schema}.workshops`;
const seedDate = new Date('2026-10-10T23:45:00-05:00');
const execFileAsync = promisify(execFile);

describe('Workshop persistence (real PostgreSQL)', () => {
  let control: DataSource;
  let database: DataSource;
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
    database = new DataSource({
      ...options,
      schema,
      logging: false,
      migrations: [CreateWorkshops1791590400000],
      entities: [WorkshopEntity],
    });
    await database.initialize();
    await database.runMigrations();
  });

  afterAll(async () => {
    try {
      if (database?.isInitialized) await database.destroy();
    } finally {
      if (control?.isInitialized) {
        const runner = control.createQueryRunner();
        try {
          // Only the exact random schema created by this test run is removed.
          if (schemaCreated) await runner.dropSchema(schema, true, true);
        } finally {
          await runner.release();
          await control.destroy();
        }
      }
    }
  });

  beforeEach(async () => {
    await database.getRepository(WorkshopEntity).clear();
  });

  function record(id = 'constraint-test') {
    return {
      id,
      title: 'A valid workshop',
      capacity: 5,
      startsAt: new Date('2026-11-01T15:30:00+05:30'),
    };
  }

  it('records the migration once and has no work on the next run', async () => {
    const runner = database.createQueryRunner();
    try {
      expect(await runner.hasTable(tablePath)).toBe(true);
      expect(await database.showMigrations()).toBe(false);
      expect(await database.runMigrations()).toEqual([]);
      const history = await database.query<{ name: string }[]>(
        `SELECT name FROM "${schema}"."migrations"`,
      );
      expect(history).toEqual([{ name: 'CreateWorkshops1791590400000' }]);
    } finally {
      await runner.release();
    }
  });

  it('matches the entity metadata, column types, and named constraints', async () => {
    const runner = database.createQueryRunner();
    try {
      const table = await runner.getTable(tablePath);
      expect(table).toBeDefined();
      expect(table!.columns.map((column) => column.name)).toEqual([
        'id',
        'title',
        'capacity',
        'reserved_seats',
        'registration_open',
        'starts_at',
        'created_at',
        'updated_at',
      ]);
      expect(
        table!.columns.find((column) => column.name === 'id'),
      ).toMatchObject({
        type: 'character varying',
        length: '64',
        isPrimary: true,
      });
      expect(
        table!.columns.find((column) => column.name === 'title'),
      ).toMatchObject({
        type: 'character varying',
        length: '200',
      });
      expect(
        table!.columns
          .filter((column) => column.name.endsWith('_at'))
          .map((column) => column.type),
      ).toEqual([
        'timestamp with time zone',
        'timestamp with time zone',
        'timestamp with time zone',
      ]);
      expect(table!.columns.every((column) => !column.isNullable)).toBe(true);
      expect(
        table!.checks
          .map((check) => check.name ?? '')
          .sort((left, right) => left.localeCompare(right)),
      ).toEqual([
        'CHK_workshops_capacity_positive',
        'CHK_workshops_reserved_seats_range',
        'CHK_workshops_title_nonblank',
      ]);
      // Compare without changing anything: synchronization must have no proposed SQL.
      const difference = await database.driver.createSchemaBuilder().log();
      expect(difference.upQueries).toEqual([]);
    } finally {
      await runner.release();
    }
  });

  it('round-trips timestamps and applies database defaults', async () => {
    const repository = database.getRepository(WorkshopEntity);
    await repository.insert(record());
    const stored = await repository.findOneByOrFail({ id: 'constraint-test' });
    expect(stored).toBeInstanceOf(WorkshopEntity);
    expect(stored.reservedSeats).toBe(0);
    expect(stored.registrationOpen).toBe(true);
    expect(stored.startsAt.toISOString()).toBe('2026-11-01T10:00:00.000Z');
    expect(stored.createdAt).toBeInstanceOf(Date);
    expect(stored.updatedAt).toBeInstanceOf(Date);
    expect(stored.updatedAt.getTime()).toBe(stored.createdAt.getTime());
    expect(stored).not.toHaveProperty('availableSeats');
    await database.query(
      `UPDATE "${schema}"."workshops" SET updated_at = $1 WHERE id = $2`,
      [new Date('2000-01-01T00:00:00Z'), stored.id],
    );
    await repository.update(stored.id, { title: 'Updated through TypeORM' });
    const updated = await repository.findOneByOrFail({ id: stored.id });
    expect(updated.updatedAt.getTime()).toBeGreaterThan(
      Date.parse('2000-01-01T00:00:00Z'),
    );
    expect(updated.createdAt.getTime()).toBe(stored.createdAt.getTime());
  });

  it.each([
    ['empty title', { title: '' }, 'CHK_workshops_title_nonblank'],
    ['whitespace title', { title: ' \t\n ' }, 'CHK_workshops_title_nonblank'],
    ['zero capacity', { capacity: 0 }, 'CHK_workshops_capacity_positive'],
    ['negative capacity', { capacity: -1 }, 'CHK_workshops_capacity_positive'],
    [
      'negative reservations',
      { reservedSeats: -1 },
      'CHK_workshops_reserved_seats_range',
    ],
    [
      'reservations above capacity',
      { reservedSeats: 6 },
      'CHK_workshops_reserved_seats_range',
    ],
  ])(
    'rejects %s at the database boundary',
    async (_label, invalid, constraint) => {
      await expect(
        database
          .getRepository(WorkshopEntity)
          .insert({ ...record(), ...invalid }),
      ).rejects.toMatchObject({ driverError: { code: '23514', constraint } });
    },
  );

  it('rejects duplicate primary keys', async () => {
    const repository = database.getRepository(WorkshopEntity);
    await repository.insert(record());
    await expect(repository.insert(record())).rejects.toMatchObject({
      driverError: { code: '23505', constraint: 'PK_workshops' },
    });
  });

  it.each([0, 5])(
    'accepts a valid reserved-seat boundary of %s',
    async (reservedSeats) => {
      const repository = database.getRepository(WorkshopEntity);
      await repository.insert({ ...record(), reservedSeats });
      expect(
        (await repository.findOneByOrFail({ id: 'constraint-test' }))
          .reservedSeats,
      ).toBe(reservedSeats);
    },
  );

  it('seeds the expected records and UTC dates', async () => {
    expect(await seedWorkshops(database, seedDate)).toEqual({
      inserted: 3,
      skipped: 0,
    });
    const rows = await database
      .getRepository(WorkshopEntity)
      .find({ order: { id: 'ASC' } });
    expect(
      rows.map(
        ({
          id,
          title,
          capacity,
          reservedSeats,
          registrationOpen,
          startsAt,
        }) => ({
          id,
          title,
          capacity,
          reservedSeats,
          registrationOpen,
          startsAt: startsAt.toISOString(),
        }),
      ),
    ).toEqual([
      {
        id: 'workshop-1',
        title: 'NestJS basics',
        capacity: 20,
        reservedSeats: 0,
        registrationOpen: true,
        startsAt: '2026-10-18T10:00:00.000Z',
      },
      {
        id: 'workshop-2',
        title: 'Angular reactive forms',
        capacity: 10,
        reservedSeats: 0,
        registrationOpen: false,
        startsAt: '2026-10-25T10:00:00.000Z',
      },
      {
        id: 'workshop-3',
        title: 'PostgreSQL transactions',
        capacity: 12,
        reservedSeats: 0,
        registrationOpen: true,
        startsAt: '2026-11-01T10:00:00.000Z',
      },
    ]);
  });

  it('preserves every field and timestamp when seeded again', async () => {
    await seedWorkshops(database, seedDate);
    const repository = database.getRepository(WorkshopEntity);
    await repository.update('workshop-1', {
      title: 'Locally edited title',
      capacity: 30,
      reservedSeats: 3,
      registrationOpen: false,
      startsAt: new Date('2030-04-05T10:00:00Z'),
    });
    const before = await repository.find({ order: { id: 'ASC' } });
    expect(
      await seedWorkshops(database, new Date('2027-01-01T00:00:00Z')),
    ).toEqual({ inserted: 0, skipped: 3 });
    expect(await repository.find({ order: { id: 'ASC' } })).toEqual(before);
  });

  it('fills only missing seed IDs and leaves other records alone', async () => {
    const repository = database.getRepository(WorkshopEntity);
    await repository.insert(record('unrelated-workshop'));
    await repository.insert(record('workshop-1'));
    const before = await repository.findOneByOrFail({ id: 'workshop-1' });
    expect(await seedWorkshops(database, seedDate)).toEqual({
      inserted: 2,
      skipped: 1,
    });
    expect(await repository.count()).toBe(4);
    expect(await repository.findOneByOrFail({ id: 'workshop-1' })).toEqual(
      before,
    );
    expect(
      await repository.findOneByOrFail({ id: 'unrelated-workshop' }),
    ).toMatchObject(record('unrelated-workshop'));
  });

  it('rolls back the entire seed when the database rejects one record', async () => {
    const runner = database.createQueryRunner();
    try {
      await runner.query(
        `ALTER TABLE "${schema}"."workshops" ADD CONSTRAINT "CHK_test_seed_failure" CHECK (id <> 'workshop-2')`,
      );
      await expect(seedWorkshops(database, seedDate)).rejects.toMatchObject({
        driverError: { code: '23514', constraint: 'CHK_test_seed_failure' },
      });
      expect(await database.getRepository(WorkshopEntity).count()).toBe(0);
    } finally {
      await runner.query(
        `ALTER TABLE "${schema}"."workshops" DROP CONSTRAINT "CHK_test_seed_failure"`,
      );
      await runner.release();
    }
  });

  it('refuses the CLI seed outside development before connecting', async () => {
    try {
      await execFileAsync(process.execPath, ['dist/database/seed.js'], {
        cwd: fileURLToPath(new URL('../', import.meta.url)),
        env: { ...process.env, NODE_ENV: 'production', DB_PORT: '1' },
        windowsHide: true,
      });
      throw new Error('Expected the development-only seed to fail');
    } catch (error) {
      expect(error).toMatchObject({ code: 1 });
      expect((error as { stderr: string }).stderr).toContain(
        'The workshop seed command requires NODE_ENV=development.',
      );
    }
  });

  it('reverts and reapplies only the isolated schema migration', async () => {
    const runner = database.createQueryRunner();
    try {
      await database.undoLastMigration();
      expect(await runner.hasTable(tablePath)).toBe(false);
      expect(await database.showMigrations()).toBe(true);
      await expect(seedWorkshops(database, seedDate)).rejects.toMatchObject({
        driverError: { code: '42P01' },
      });
    } finally {
      await database.runMigrations();
      await runner.release();
    }
    expect(await seedWorkshops(database, seedDate)).toEqual({
      inserted: 3,
      skipped: 0,
    });
  });
});
