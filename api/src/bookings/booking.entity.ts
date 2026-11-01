import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import { UserEntity } from '../users/user.entity.js';
import { WorkshopEntity } from '../workshops/workshop.entity.js';

export type BookingStatus = 'ACTIVE' | 'CANCELLED';
@Entity('bookings')
@Check('CHK_bookings_status', `"status" IN ('ACTIVE', 'CANCELLED')`)
@Check(
  'CHK_bookings_cancellation',
  `("status" = 'ACTIVE' AND "cancelled_at" IS NULL) OR ("status" = 'CANCELLED' AND "cancelled_at" IS NOT NULL)`,
)
@Index('UQ_bookings_active_user_workshop', ['userId', 'workshopId'], {
  unique: true,
  where: `"status" = 'ACTIVE'`,
})
@Index('IDX_bookings_user_id', ['userId'])
@Index('IDX_bookings_workshop_order', ['workshopId', 'createdAt', 'id'])
export class BookingEntity {
  @PrimaryColumn({ type: 'uuid', primaryKeyConstraintName: 'PK_bookings' })
  id: string;
  @Column({ name: 'user_id', type: 'uuid' }) userId: string;
  @Column({ name: 'workshop_id', type: 'varchar', length: 64 })
  workshopId: string;
  @Column({ type: 'varchar', length: 16, default: 'ACTIVE' })
  status: BookingStatus;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
  @Column({ name: 'cancelled_at', type: 'timestamptz', nullable: true })
  cancelledAt: Date | null;
  @ManyToOne(() => UserEntity, { onDelete: 'NO ACTION', onUpdate: 'NO ACTION' })
  @JoinColumn({ name: 'user_id', foreignKeyConstraintName: 'FK_bookings_user' })
  user: UserEntity;
  @ManyToOne(() => WorkshopEntity, {
    onDelete: 'NO ACTION',
    onUpdate: 'NO ACTION',
  })
  @JoinColumn({
    name: 'workshop_id',
    foreignKeyConstraintName: 'FK_bookings_workshop',
  })
  workshop: WorkshopEntity;
}
