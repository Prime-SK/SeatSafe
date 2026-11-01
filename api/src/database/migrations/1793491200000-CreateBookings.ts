import { Table, TableCheck, TableForeignKey, TableIndex } from 'typeorm';
import type { MigrationInterface, QueryRunner } from 'typeorm';
export class CreateBookings1793491200000 implements MigrationInterface {
  name = 'CreateBookings1793491200000';
  private schema(runner: QueryRunner): string {
    if (runner.connection.options.type !== 'postgres')
      throw new Error('The booking migration requires PostgreSQL.');
    return runner.connection.options.schema ?? 'public';
  }
  async up(runner: QueryRunner): Promise<void> {
    const schema = this.schema(runner);
    await runner.createTable(
      new Table({
        name: 'bookings',
        schema,
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            primaryKeyConstraintName: 'PK_bookings',
          },
          { name: 'user_id', type: 'uuid' },
          { name: 'workshop_id', type: 'varchar', length: '64' },
          {
            name: 'status',
            type: 'varchar',
            length: '16',
            default: "'ACTIVE'",
          },
          { name: 'created_at', type: 'timestamptz', default: 'now()' },
          { name: 'cancelled_at', type: 'timestamptz', isNullable: true },
        ],
        checks: [
          new TableCheck({
            name: 'CHK_bookings_status',
            expression: `"status" IN ('ACTIVE', 'CANCELLED')`,
          }),
          new TableCheck({
            name: 'CHK_bookings_cancellation',
            expression: `("status" = 'ACTIVE' AND "cancelled_at" IS NULL) OR ("status" = 'CANCELLED' AND "cancelled_at" IS NOT NULL)`,
          }),
        ],
        foreignKeys: [
          new TableForeignKey({
            name: 'FK_bookings_user',
            columnNames: ['user_id'],
            referencedSchema: schema,
            referencedTableName: 'users',
            referencedColumnNames: ['id'],
            onDelete: 'NO ACTION',
            onUpdate: 'NO ACTION',
          }),
          new TableForeignKey({
            name: 'FK_bookings_workshop',
            columnNames: ['workshop_id'],
            referencedSchema: schema,
            referencedTableName: 'workshops',
            referencedColumnNames: ['id'],
            onDelete: 'NO ACTION',
            onUpdate: 'NO ACTION',
          }),
        ],
        indices: [
          new TableIndex({
            name: 'UQ_bookings_active_user_workshop',
            columnNames: ['user_id', 'workshop_id'],
            isUnique: true,
            where: `"status" = 'ACTIVE'`,
          }),
          new TableIndex({
            name: 'IDX_bookings_user_id',
            columnNames: ['user_id'],
          }),
          new TableIndex({
            name: 'IDX_bookings_workshop_order',
            columnNames: ['workshop_id', 'created_at', 'id'],
          }),
        ],
      }),
    );
  }
  async down(runner: QueryRunner): Promise<void> {
    await runner.dropTable(`${this.schema(runner)}.bookings`);
  }
}
