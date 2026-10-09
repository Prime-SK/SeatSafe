import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import type { HealthResponseDto } from './health-response.dto.js';

@Injectable()
export class HealthService {
  constructor(@InjectDataSource() private readonly database: DataSource) {}

  async check(): Promise<HealthResponseDto> {
    try {
      await this.database.query('SELECT 1');
      return { status: 'ok', database: 'up' };
    } catch {
      // Do not expose driver errors, connection details, or credentials.
      throw new ServiceUnavailableException('Database unavailable');
    }
  }
}
