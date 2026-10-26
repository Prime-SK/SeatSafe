import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  Check,
} from 'typeorm';
import { AuthSessionEntity } from './auth-session.entity.js';

@Entity('auth_refresh_tokens')
@Index('UQ_auth_refresh_tokens_hash', ['tokenHash'], { unique: true })
@Index('IDX_auth_refresh_tokens_session', ['sessionId'])
@Index('UQ_auth_refresh_tokens_unconsumed', ['sessionId'], {
  unique: true,
  where: '"consumed_at" IS NULL',
})
@Check('CHK_auth_refresh_tokens_hash', '"token_hash" ~ \'^[0-9a-f]{64}$\'')
export class AuthRefreshTokenEntity {
  @PrimaryColumn({
    type: 'uuid',
    primaryKeyConstraintName: 'PK_auth_refresh_tokens',
  })
  id: string;
  @Column({ name: 'session_id', type: 'uuid' }) sessionId: string;
  @ManyToOne(() => AuthSessionEntity, {
    nullable: false,
    onDelete: 'NO ACTION',
    onUpdate: 'NO ACTION',
  })
  @JoinColumn({
    name: 'session_id',
    foreignKeyConstraintName: 'FK_auth_refresh_tokens_session',
  })
  session: AuthSessionEntity;
  @Column({ name: 'token_hash', type: 'varchar', length: 64, select: false })
  tokenHash: string;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
  @Column({ name: 'consumed_at', type: 'timestamptz', nullable: true })
  consumedAt: Date | null;
}
