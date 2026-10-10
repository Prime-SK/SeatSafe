import { Table, TableForeignKey, TableIndex } from 'typeorm';
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAuthSessions1791763200000 implements MigrationInterface {
  name = 'CreateAuthSessions1791763200000';
  private schema(runner: QueryRunner): string {
    if (runner.connection.options.type !== 'postgres')
      throw new Error('The session migration requires PostgreSQL.');
    return runner.connection.options.schema ?? 'public';
  }
  async up(runner: QueryRunner): Promise<void> {
    const schema = this.schema(runner);
    await runner.createTable(
      new Table({
        name: 'auth_sessions',
        schema,
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            primaryKeyConstraintName: 'PK_auth_sessions',
          },
          { name: 'user_id', type: 'uuid' },
          { name: 'created_at', type: 'timestamptz', default: 'now()' },
          { name: 'expires_at', type: 'timestamptz' },
          { name: 'revoked_at', type: 'timestamptz', isNullable: true },
        ],
        foreignKeys: [
          new TableForeignKey({
            name: 'FK_auth_sessions_user',
            columnNames: ['user_id'],
            referencedSchema: schema,
            referencedTableName: 'users',
            referencedColumnNames: ['id'],
            onDelete: 'NO ACTION',
            onUpdate: 'NO ACTION',
          }),
        ],
        indices: [
          new TableIndex({
            name: 'IDX_auth_sessions_user_id',
            columnNames: ['user_id'],
          }),
        ],
      }),
    );
  }
  async down(runner: QueryRunner): Promise<void> {
    await runner.dropTable(`${this.schema(runner)}.auth_sessions`);
  }
}
