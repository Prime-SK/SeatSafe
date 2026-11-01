import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  Unique,
} from 'typeorm';
import { UserEntity } from '../users/user.entity.js';
import type { BookingResponseDto } from './booking.dto.js';

export type BookingOutcome = {
  status: 201 | 404 | 409;
  body:
    BookingResponseDto | { statusCode: number; code: string; message: string };
};

@Entity('booking_idempotency_records')
@Unique('UQ_booking_idempotency_user_key', ['userId', 'requestKey'])
@Check(
  'CHK_booking_idempotency_key',
  `"request_key" ~ '^[A-Za-z0-9_-]{16,128}$'`,
)
@Check(
  'CHK_booking_idempotency_fingerprint',
  `"fingerprint" ~ '^[0-9a-f]{64}$'`,
)
@Check('CHK_booking_idempotency_status', `"http_status" IN (201, 404, 409)`)
@Check(
  'CHK_booking_idempotency_response',
  `jsonb_typeof("response") = 'object'`,
)
export class BookingIdempotencyEntity {
  @PrimaryColumn({
    type: 'uuid',
    primaryKeyConstraintName: 'PK_booking_idempotency',
  })
  id: string;
  @Column({ name: 'user_id', type: 'uuid' }) userId: string;
  @Column({ name: 'request_key', type: 'varchar', length: 128 })
  requestKey: string;
  @Column({ type: 'varchar', length: 64 }) fingerprint: string;
  @Column({ name: 'http_status', type: 'integer' })
  httpStatus: BookingOutcome['status'];
  @Column({ type: 'jsonb' }) response: BookingOutcome['body'];
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
  @ManyToOne(() => UserEntity, { onDelete: 'NO ACTION', onUpdate: 'NO ACTION' })
  @JoinColumn({
    name: 'user_id',
    foreignKeyConstraintName: 'FK_booking_idempotency_user',
  })
  user: UserEntity;
}
