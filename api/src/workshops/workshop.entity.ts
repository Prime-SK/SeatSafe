import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('workshops')
@Check('CHK_workshops_title_nonblank', `"title" ~ '[^[:space:]]'`)
@Check('CHK_workshops_capacity_positive', '"capacity" > 0')
@Check(
  'CHK_workshops_reserved_seats_range',
  '"reserved_seats" >= 0 AND "reserved_seats" <= "capacity"',
)
export class WorkshopEntity {
  @PrimaryColumn({
    type: 'varchar',
    length: 64,
    primaryKeyConstraintName: 'PK_workshops',
  })
  id: string;

  @Column({ type: 'varchar', length: 200 })
  title: string;

  @Column({ type: 'integer' })
  capacity: number;

  @Column({ name: 'reserved_seats', type: 'integer', default: 0 })
  reservedSeats: number;

  @Column({ name: 'registration_open', type: 'boolean', default: true })
  registrationOpen: boolean;

  @Column({ name: 'starts_at', type: 'timestamptz' })
  startsAt: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
