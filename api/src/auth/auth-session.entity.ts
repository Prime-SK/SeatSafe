import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import { UserEntity } from '../users/user.entity.js';

@Entity('auth_sessions')
@Index('IDX_auth_sessions_user_id', ['userId'])
export class AuthSessionEntity {
  @PrimaryColumn({ type: 'uuid', primaryKeyConstraintName: 'PK_auth_sessions' })
  id: string;
  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;
  @ManyToOne(() => UserEntity, {
    nullable: false,
    onDelete: 'NO ACTION',
    onUpdate: 'NO ACTION',
  })
  @JoinColumn({
    name: 'user_id',
    foreignKeyConstraintName: 'FK_auth_sessions_user',
  })
  user: UserEntity;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;
  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt: Date | null;
}
