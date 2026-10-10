import { Table, TableCheck, TableUnique } from 'typeorm';
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateUsers1791676800000 implements MigrationInterface {
  name = 'CreateUsers1791676800000';
  private schema(queryRunner: QueryRunner): string {
    const options = queryRunner.connection.options;
    if (options.type !== 'postgres')
      throw new Error('The user migration requires PostgreSQL.');
    return options.schema ?? 'public';
  }
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'users',
        schema: this.schema(queryRunner),
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            primaryKeyConstraintName: 'PK_users',
          },
          { name: 'display_name', type: 'varchar', length: '100' },
          { name: 'email', type: 'varchar', length: '254' },
          { name: 'password_hash', type: 'text' },
          { name: 'role', type: 'varchar', length: '16', default: "'USER'" },
          { name: 'is_enabled', type: 'boolean', default: 'true' },
          { name: 'created_at', type: 'timestamptz', default: 'now()' },
          { name: 'updated_at', type: 'timestamptz', default: 'now()' },
        ],
        uniques: [
          new TableUnique({ name: 'UQ_users_email', columnNames: ['email'] }),
        ],
        checks: [
          new TableCheck({
            name: 'CHK_users_display_name_nonblank',
            expression: `"display_name" ~ '[^[:space:]]'`,
          }),
          new TableCheck({
            name: 'CHK_users_email_normalized',
            expression: `"email" = lower(btrim("email")) AND "email" <> ''`,
          }),
          new TableCheck({
            name: 'CHK_users_role',
            expression: `"role" IN ('USER', 'ADMIN')`,
          }),
        ],
      }),
    );
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable(`${this.schema(queryRunner)}.users`);
  }
}
