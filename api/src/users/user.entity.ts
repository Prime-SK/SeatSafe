import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

@Entity('users')
@Unique('UQ_users_email', ['email'])
@Check('CHK_users_display_name_nonblank', `"display_name" ~ '[^[:space:]]'`)
@Check(
  'CHK_users_email_normalized',
  `"email" = lower(btrim("email")) AND "email" <> ''`,
)
@Check('CHK_users_role', `"role" IN ('USER', 'ADMIN')`)
export class UserEntity {
  @PrimaryColumn({ type: 'uuid', primaryKeyConstraintName: 'PK_users' })
  id: string;
  @Column({ name: 'display_name', type: 'varchar', length: 100 })
  displayName: string;
  @Column({ type: 'varchar', length: 254 })
  email: string;
  @Column({ name: 'password_hash', type: 'text', select: false })
  passwordHash: string;
  @Column({ type: 'varchar', length: 16, default: 'USER' })
  role: 'USER' | 'ADMIN';
  @Column({ name: 'is_enabled', type: 'boolean', default: true })
  isEnabled: boolean;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
