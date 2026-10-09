import { Controller, Get, NotFoundException, Param } from '@nestjs/common';
import {
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { WorkshopResponseDto } from './workshop-response.dto.js';
import { WorkshopsService } from './workshops.service.js';
import type { WorkshopResponse } from './workshop.types.js';

const databaseUnavailableResponse = {
  description: 'The database cannot currently answer the workshop query.',
  schema: {
    type: 'object',
    required: ['statusCode', 'message', 'error'],
    properties: {
      statusCode: { type: 'integer', example: 503 },
      message: { type: 'string', example: 'Database unavailable' },
      error: { type: 'string', example: 'Service Unavailable' },
    },
  },
};

@ApiTags('Workshops')
@Controller('workshops')
export class WorkshopsController {
  constructor(private readonly workshopsService: WorkshopsService) {}

  @Get()
  @ApiOperation({
    summary: 'List workshops',
    description:
      'Reads all workshops from PostgreSQL, ordered by start time then ID. Includes closed, sold-out, and past workshops.',
  })
  @ApiOkResponse({ type: WorkshopResponseDto, isArray: true })
  @ApiServiceUnavailableResponse(databaseUnavailableResponse)
  findAll(): Promise<WorkshopResponse[]> {
    return this.workshopsService.findAll();
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get a workshop',
    description: 'Reads one workshop from PostgreSQL by its opaque string ID.',
  })
  @ApiParam({
    name: 'id',
    type: String,
    example: 'workshop-1',
    description: 'Workshop ID.',
  })
  @ApiOkResponse({ type: WorkshopResponseDto })
  @ApiServiceUnavailableResponse(databaseUnavailableResponse)
  @ApiNotFoundResponse({
    description: 'No workshop matches the supplied ID.',
    schema: {
      type: 'object',
      required: ['message', 'error', 'statusCode'],
      properties: {
        message: { type: 'string', example: 'Workshop not found' },
        error: { type: 'string', example: 'Not Found' },
        statusCode: { type: 'integer', example: 404 },
      },
    },
  })
  async findById(@Param('id') id: string): Promise<WorkshopResponse> {
    const workshop = await this.workshopsService.findById(id);

    if (workshop === undefined) {
      throw new NotFoundException('Workshop not found');
    }

    return workshop;
  }
}
