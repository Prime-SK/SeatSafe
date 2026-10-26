import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import type { EntityManager } from 'typeorm';
import { WorkshopEntity } from '../workshops/workshop.entity.js';
import { toWorkshopResponse } from '../workshops/workshop-response.js';
import type { WorkshopResponse } from '../workshops/workshop.types.js';
import type {
  CreateWorkshopDto,
  UpdateWorkshopDto,
} from './workshop-write.dto.js';
import { WorkshopAdminError, invalidWorkshop } from './workshop-admin-error.js';

@Injectable()
export class AdminWorkshopsService {
  constructor(@InjectDataSource() private readonly database: DataSource) {}

  async create(input: CreateWorkshopDto): Promise<WorkshopResponse> {
    const id = randomUUID();
    return this.persist(async (manager) => {
      const startsAt = new Date(input.startsAt);
      this.requireFuture(startsAt);
      const repository = manager.getRepository(WorkshopEntity);
      const workshop = repository.create({
        id,
        title: input.title,
        capacity: input.capacity,
        startsAt,
        registrationOpen: input.registrationOpen ?? true,
        reservedSeats: 0,
      });
      await repository.insert(workshop);
      return this.response(workshop, 'create');
    });
  }

  async update(
    id: string,
    input: UpdateWorkshopDto,
  ): Promise<WorkshopResponse> {
    if (
      [
        input.title,
        input.capacity,
        input.startsAt,
        input.registrationOpen,
      ].every((value) => value === undefined)
    )
      throw invalidWorkshop(
        'body',
        'Supply at least one editable workshop field',
      );
    return this.persist(async (manager) => {
      const repository = manager.getRepository(WorkshopEntity);
      const workshop = await repository
        .createQueryBuilder('workshop')
        .setLock('pessimistic_write')
        .where('workshop.id = :id', { id })
        .getOne();
      if (!workshop)
        throw new WorkshopAdminError(
          404,
          'WORKSHOP_NOT_FOUND',
          'Workshop not found',
        );
      const startsAt =
        input.startsAt === undefined
          ? workshop.startsAt
          : new Date(input.startsAt);
      if (startsAt.getTime() !== workshop.startsAt.getTime())
        this.requireFuture(startsAt);
      const capacity = input.capacity ?? workshop.capacity;
      if (capacity < workshop.reservedSeats)
        throw new WorkshopAdminError(
          409,
          'CAPACITY_BELOW_RESERVED',
          'Capacity cannot be below reserved seats',
        );
      if (input.registrationOpen === true && startsAt.getTime() <= Date.now())
        throw new WorkshopAdminError(
          409,
          'WORKSHOP_ALREADY_STARTED',
          'Cannot open registration for a workshop that has already started',
        );
      // Read under the lock and merge only supplied fields; omitted values remain current.
      const changes = {
        title: input.title ?? workshop.title,
        capacity,
        startsAt,
        registrationOpen: input.registrationOpen ?? workshop.registrationOpen,
      };
      await repository.update(id, changes);
      Object.assign(workshop, changes);
      return this.response(workshop, 'update');
    });
  }

  private requireFuture(startsAt: Date): void {
    if (
      !Number.isFinite(startsAt.getTime()) ||
      startsAt.getTime() <= Date.now()
    )
      throw invalidWorkshop('startsAt', 'Workshop start must be in the future');
  }
  private response(
    workshop: WorkshopEntity,
    operation: string,
  ): WorkshopResponse {
    try {
      return toWorkshopResponse(workshop);
    } catch {
      throw new WorkshopAdminError(
        500,
        'INTERNAL_ERROR',
        `Unable to ${operation} workshop`,
      );
    }
  }
  private async persist<T>(
    work: (manager: EntityManager) => Promise<T>,
  ): Promise<T> {
    try {
      return await this.database.transaction(work);
    } catch (error) {
      if (error instanceof WorkshopAdminError) throw error;
      throw new WorkshopAdminError(
        503,
        'DATABASE_UNAVAILABLE',
        'Database unavailable',
      );
    }
  }
}
