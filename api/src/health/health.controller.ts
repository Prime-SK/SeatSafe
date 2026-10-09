import { Controller, Get } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { HealthResponseDto } from './health-response.dto.js';
import { HealthService } from './health.service.js';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  @ApiOperation({
    summary: 'Check database connectivity',
    description: 'Runs SELECT 1 through the application database connection.',
  })
  @ApiOkResponse({ type: HealthResponseDto })
  @ApiServiceUnavailableResponse({
    description: 'The database cannot currently answer the health query.',
    schema: {
      type: 'object',
      required: ['statusCode', 'message', 'error'],
      properties: {
        statusCode: { type: 'integer', example: 503 },
        message: { type: 'string', example: 'Database unavailable' },
        error: { type: 'string', example: 'Service Unavailable' },
      },
    },
  })
  check(): Promise<HealthResponseDto> {
    return this.healthService.check();
  }
}
