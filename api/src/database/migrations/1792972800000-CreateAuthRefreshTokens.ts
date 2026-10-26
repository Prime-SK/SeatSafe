import { Table, TableCheck, TableForeignKey, TableIndex } from 'typeorm';
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAuthRefreshTokens1792972800000 implements MigrationInterface {
  name = 'CreateAuthRefreshTokens1792972800000';
  private schema(runner: QueryRunner): string {
    if (runner.connection.options.type !== 'postgres')
      throw new Error('Refresh storage requires PostgreSQL.');
    return runner.connection.options.schema ?? 'public';
  }
  async up(runner: QueryRunner): Promise<void> {
    const schema = this.schema(runner);
    await runner.createTable(
      new Table({
        name: 'auth_refresh_tokens',
        schema,
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            primaryKeyConstraintName: 'PK_auth_refresh_tokens',
          },
          { name: 'session_id', type: 'uuid' },
          { name: 'token_hash', type: 'varchar', length: '64' },
          { name: 'created_at', type: 'timestamptz', default: 'now()' },
          { name: 'consumed_at', type: 'timestamptz', isNullable: true },
        ],
        checks: [
          new TableCheck({
            name: 'CHK_auth_refresh_tokens_hash',
            expression: '"token_hash" ~ \'^[0-9a-f]{64}$\'',
          }),
        ],
        foreignKeys: [
          new TableForeignKey({
            name: 'FK_auth_refresh_tokens_session',
            columnNames: ['session_id'],
            referencedSchema: schema,
            referencedTableName: 'auth_sessions',
            referencedColumnNames: ['id'],
            onDelete: 'NO ACTION',
            onUpdate: 'NO ACTION',
          }),
        ],
        indices: [
          new TableIndex({
            name: 'UQ_auth_refresh_tokens_hash',
            columnNames: ['token_hash'],
            isUnique: true,
          }),
          new TableIndex({
            name: 'IDX_auth_refresh_tokens_session',
            columnNames: ['session_id'],
          }),
          new TableIndex({
            name: 'UQ_auth_refresh_tokens_unconsumed',
            columnNames: ['session_id'],
            isUnique: true,
            where: '"consumed_at" IS NULL',
          }),
        ],
      }),
    );
  }
  async down(runner: QueryRunner): Promise<void> {
    await runner.dropTable(`${this.schema(runner)}.auth_refresh_tokens`);
  }
}
