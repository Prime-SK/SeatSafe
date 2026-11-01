import { Table, TableCheck, TableForeignKey, TableUnique } from 'typeorm';
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateBookingIdempotency1793577600000 implements MigrationInterface {
  name = 'CreateBookingIdempotency1793577600000';
  private schema(runner: QueryRunner): string {
    if (runner.connection.options.type !== 'postgres')
      throw new Error('The idempotency migration requires PostgreSQL.');
    return runner.connection.options.schema ?? 'public';
  }
  async up(runner: QueryRunner): Promise<void> {
    const schema = this.schema(runner);
    await runner.createTable(
      new Table({
        name: 'booking_idempotency_records',
        schema,
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            primaryKeyConstraintName: 'PK_booking_idempotency',
          },
          { name: 'user_id', type: 'uuid' },
          { name: 'request_key', type: 'varchar', length: '128' },
          { name: 'fingerprint', type: 'varchar', length: '64' },
          { name: 'http_status', type: 'integer' },
          { name: 'response', type: 'jsonb' },
          { name: 'created_at', type: 'timestamptz', default: 'now()' },
        ],
        uniques: [
          new TableUnique({
            name: 'UQ_booking_idempotency_user_key',
            columnNames: ['user_id', 'request_key'],
          }),
        ],
        checks: [
          new TableCheck({
            name: 'CHK_booking_idempotency_key',
            expression: `"request_key" ~ '^[A-Za-z0-9_-]{16,128}$'`,
          }),
          new TableCheck({
            name: 'CHK_booking_idempotency_fingerprint',
            expression: `"fingerprint" ~ '^[0-9a-f]{64}$'`,
          }),
          new TableCheck({
            name: 'CHK_booking_idempotency_status',
            expression: `"http_status" IN (201, 404, 409)`,
          }),
          new TableCheck({
            name: 'CHK_booking_idempotency_response',
            expression: `jsonb_typeof("response") = 'object'`,
          }),
        ],
        foreignKeys: [
          new TableForeignKey({
            name: 'FK_booking_idempotency_user',
            columnNames: ['user_id'],
            referencedSchema: schema,
            referencedTableName: 'users',
            referencedColumnNames: ['id'],
            onDelete: 'NO ACTION',
            onUpdate: 'NO ACTION',
          }),
        ],
      }),
    );
  }
  async down(runner: QueryRunner): Promise<void> {
    await runner.dropTable(
      `${this.schema(runner)}.booking_idempotency_records`,
    );
  }
}
