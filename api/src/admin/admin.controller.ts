import { Controller, Get, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiProperty,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { Roles } from '../auth/roles.decorator.js';

class AdminAccessDto {
  @ApiProperty({ type: Boolean, enum: [true], example: true })
  authorized: true;
}

const headers = {
  'Cache-Control': {
    description: 'Do not cache access checks.',
    schema: { type: 'string', example: 'no-store' },
  },
};

@ApiTags('Admin')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
@Controller('admin')
export class AdminController {
  @Get('access')
  @ApiOperation({
    summary: 'Check administrator access',
    description:
      'Read-only check of the current database role after token and session authentication. Performs no writes.',
  })
  @ApiResponse({ status: 200, type: AdminAccessDto, headers })
  @ApiResponse({
    status: 401,
    headers: {
      ...headers,
      'WWW-Authenticate': {
        description: 'Bearer authentication required.',
        schema: { type: 'string', example: 'Bearer' },
      },
    },
    schema: errorSchema(401, 'UNAUTHORIZED', 'Authentication required'),
  })
  @ApiResponse({
    status: 403,
    headers,
    schema: errorSchema(403, 'FORBIDDEN', 'Insufficient permissions'),
  })
  @ApiResponse({
    status: 503,
    headers,
    schema: errorSchema(503, 'DATABASE_UNAVAILABLE', 'Database unavailable'),
  })
  access(): AdminAccessDto {
    return { authorized: true };
  }
}

function errorSchema(statusCode: number, code: string, message: string) {
  return {
    type: 'object' as const,
    required: ['statusCode', 'code', 'message'],
    properties: {
      statusCode: { type: 'integer' as const, example: statusCode },
      code: { type: 'string' as const, example: code },
      message: { type: 'string' as const, example: message },
    },
  };
}
