import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WorkshopEntity } from './workshop.entity.js';
import type { WorkshopResponse } from './workshop.types.js';
import { toWorkshopResponse } from './workshop-response.js';

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
    return records.map(toWorkshopResponse);
  }

  async findById(id: string): Promise<WorkshopResponse | undefined> {
    let workshop: WorkshopEntity | null;
    try {
      workshop = await this.workshops.findOneBy({ id });
    } catch {
      throw new ServiceUnavailableException('Database unavailable');
    }
    return workshop === null ? undefined : toWorkshopResponse(workshop);
  }
}
