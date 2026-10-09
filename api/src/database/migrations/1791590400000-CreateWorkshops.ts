import { Table, TableCheck } from 'typeorm';
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateWorkshops1791590400000 implements MigrationInterface {
  name = 'CreateWorkshops1791590400000';

  private schema(queryRunner: QueryRunner): string {
    const options = queryRunner.connection.options;
    if (options.type !== 'postgres') {
      throw new Error('The workshop migration requires PostgreSQL.');
    }
    return options.schema ?? 'public';
  }

  async up(queryRunner: QueryRunner): Promise<void> {
    // A collision must fail rather than silently accepting an unrelated table.
    await queryRunner.createTable(
      new Table({
        name: 'workshops',
        schema: this.schema(queryRunner),
        columns: [
          {
            name: 'id',
            type: 'varchar',
            length: '64',
            isPrimary: true,
            primaryKeyConstraintName: 'PK_workshops',
          },
          { name: 'title', type: 'varchar', length: '200' },
          { name: 'capacity', type: 'integer' },
          { name: 'reserved_seats', type: 'integer', default: '0' },
          { name: 'registration_open', type: 'boolean', default: 'true' },
          { name: 'starts_at', type: 'timestamptz' },
          { name: 'created_at', type: 'timestamptz', default: 'now()' },
          { name: 'updated_at', type: 'timestamptz', default: 'now()' },
        ],
        checks: [
          new TableCheck({
            name: 'CHK_workshops_title_nonblank',
            expression: `"title" ~ '[^[:space:]]'`,
          }),
          new TableCheck({
            name: 'CHK_workshops_capacity_positive',
            expression: '"capacity" > 0',
          }),
          new TableCheck({
            name: 'CHK_workshops_reserved_seats_range',
            expression:
              '"reserved_seats" >= 0 AND "reserved_seats" <= "capacity"',
          }),
        ],
      }),
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable(`${this.schema(queryRunner)}.workshops`);
  }
}
