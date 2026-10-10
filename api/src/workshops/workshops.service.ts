import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WorkshopEntity } from './workshop.entity.js';
import type { WorkshopResponse } from './workshop.types.js';

@Injectable()
export class WorkshopsService {
  constructor(
    @InjectRepository(WorkshopEntity)
    private readonly workshops: Repository<WorkshopEntity>,
  ) {}

  async findAll(): Promise<WorkshopResponse[]> {
    let records: WorkshopEntity[];
    try {
      records = await this.workshops.find({
        order: { startsAt: 'ASC', id: 'ASC' },
      });
    } catch {
      throw new ServiceUnavailableException('Database unavailable');
    }
    return records.map((workshop) => this.toResponse(workshop));
  }

  async findById(id: string): Promise<WorkshopResponse | undefined> {
    let workshop: WorkshopEntity | null;
    try {
      workshop = await this.workshops.findOneBy({ id });
    } catch {
      throw new ServiceUnavailableException('Database unavailable');
    }
    return workshop === null ? undefined : this.toResponse(workshop);
  }

  private toResponse(workshop: WorkshopEntity): WorkshopResponse {
    return {
      // Map the public contract explicitly; persistence timestamps stay private.
      id: workshop.id,
      title: workshop.title,
      capacity: workshop.capacity,
      reservedSeats: workshop.reservedSeats,
      registrationOpen: workshop.registrationOpen,
      availableSeats: workshop.capacity - workshop.reservedSeats,
      startsAt: workshop.startsAt.toISOString(),
    };
  }
}
