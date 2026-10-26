import {
  applyDecorators,
  Body,
  Controller,
  Param,
  Patch,
  Post,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import { WorkshopResponseDto } from '../workshops/workshop-response.dto.js';
import { AdminWorkshopsService } from './admin-workshops.service.js';
import { CreateWorkshopDto, UpdateWorkshopDto } from './workshop-write.dto.js';
import { WorkshopAdminFilter } from './workshop-admin.filter.js';

const headers = {
  'Cache-Control': {
    description: 'Do not cache administrator responses.',
    schema: { type: 'string', example: 'no-store' },
  },
};
function failures(update = false) {
  const responses: [number, string, string][] = [
    [400, 'VALIDATION_FAILED', 'Invalid workshop data'],
    [401, 'UNAUTHORIZED', 'Authentication required'],
    [403, 'FORBIDDEN', 'Insufficient permissions'],
    [503, 'DATABASE_UNAVAILABLE', 'Database unavailable'],
    [
      500,
      'INTERNAL_ERROR',
      update ? 'Unable to update workshop' : 'Unable to create workshop',
    ],
  ];
  if (update) responses.push([404, 'WORKSHOP_NOT_FOUND', 'Workshop not found']);
  return applyDecorators(
    ...responses.map(([statusCode, code, message]) =>
      ApiResponse({
        status: statusCode,
        headers:
          statusCode === 401
            ? {
                ...headers,
                'WWW-Authenticate': {
                  description: 'Bearer authentication required.',
                  schema: { type: 'string', example: 'Bearer' },
                },
              }
            : headers,
        schema: {
          type: 'object',
          required: [
            'statusCode',
            'code',
            'message',
            ...(statusCode === 400 ? ['fieldErrors'] : []),
          ],
          properties: {
            statusCode: { type: 'integer', example: statusCode },
            code: { type: 'string', example: code },
            message: { type: 'string', example: message },
            ...(statusCode === 400
              ? {
                  fieldErrors: {
                    type: 'object' as const,
                    additionalProperties: {
                      type: 'array' as const,
                      items: { type: 'string' as const },
                    },
                    example: {
                      startsAt: ['Workshop start must be in the future'],
                    },
                  },
                }
              : {}),
          },
        },
      }),
    ),
  );
}

@ApiTags('Admin workshops')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
@UseFilters(WorkshopAdminFilter)
@Controller('admin/workshops')
export class AdminWorkshopsController {
  constructor(private readonly workshops: AdminWorkshopsService) {}
  @Post()
  @ApiOperation({
    summary: 'Create a workshop',
    description:
      'Requires current ADMIN role. Trims title, generates an ID and starts with zero reservations. Future ISO start with Z/offset required; registration defaults to open. Rejects unknown fields and nulls.',
  })
  @ApiResponse({ status: 201, type: WorkshopResponseDto, headers })
  @failures()
  create(@Body() input: CreateWorkshopDto) {
    return this.workshops.create(input);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Edit a workshop or open/close registration',
    description:
      'Supply at least one editable field. Omitted values remain unchanged. Locks the current workshop, protects reserved capacity and requires future rescheduling/opening. An unchanged past instant may be retained. Concurrent edits serialize; later changes to the same field win.',
  })
  @ApiParam({
    name: 'id',
    example: 'workshop-1',
    description:
      'Existing opaque workshop ID, including legacy IDs and generated UUID strings.',
  })
  @ApiResponse({ status: 200, type: WorkshopResponseDto, headers })
  @failures(true)
  @ApiResponse({
    status: 409,
    headers,
    description:
      'Capacity below reserved seats or opening registration after start.',
    content: {
      'application/json': {
        schema: {
          type: 'object',
          required: ['statusCode', 'code', 'message'],
          properties: {
            statusCode: { type: 'integer', enum: [409] },
            code: {
              type: 'string',
              enum: ['CAPACITY_BELOW_RESERVED', 'WORKSHOP_ALREADY_STARTED'],
            },
            message: { type: 'string' },
          },
        },
        examples: {
          capacity: {
            value: {
              statusCode: 409,
              code: 'CAPACITY_BELOW_RESERVED',
              message: 'Capacity cannot be below reserved seats',
            },
          },
          started: {
            value: {
              statusCode: 409,
              code: 'WORKSHOP_ALREADY_STARTED',
              message:
                'Cannot open registration for a workshop that has already started',
            },
          },
        },
      },
    },
  })
  update(@Param('id') id: string, @Body() input: UpdateWorkshopDto) {
    return this.workshops.update(id, input);
  }
}
