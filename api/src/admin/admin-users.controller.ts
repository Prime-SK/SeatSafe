import {
  Body,
  Catch,
  Controller,
  Get,
  HttpException,
  Param,
  Patch,
  Query,
  UseFilters,
  UseGuards,
  applyDecorators,
} from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthenticatedPrincipal } from '../auth/authenticated-request.js';
import {
  AdminUserDto,
  AdminUserPageDto,
  UserIdPipe,
  UserListPipe,
  UserStatusDto,
  UserStatusPipe,
} from './admin-users.dto.js';
import type { UserListQuery } from './admin-users.dto.js';
import { AdminUsersService } from './admin-users.service.js';

@Catch()
export class AdminUsersFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp(),
      response = http.getResponse<Response>();
    response.setHeader('Cache-Control', 'no-store');
    if (error instanceof HttpException) {
      if (error.getStatus() === 401)
        response.setHeader('WWW-Authenticate', 'Bearer');
      response.status(error.getStatus()).json(error.getResponse());
      return;
    }
    response.status(500).json({
      statusCode: 500,
      code: 'INTERNAL_ERROR',
      message:
        http.getRequest<Request>().method === 'GET'
          ? 'Unable to list users'
          : 'Unable to update user status',
    });
  }
}
const headers = {
  'Cache-Control': { schema: { type: 'string', example: 'no-store' } },
};
function responses(update = false) {
  const errors: [number, string, string][] = [
    [400, 'VALIDATION_FAILED', 'Invalid user administration request'],
    [401, 'UNAUTHORIZED', 'Authentication required'],
    [403, 'FORBIDDEN', 'Insufficient permissions'],
    [503, 'DATABASE_UNAVAILABLE', 'Database unavailable'],
    [
      500,
      'INTERNAL_ERROR',
      update ? 'Unable to update user status' : 'Unable to list users',
    ],
  ];
  if (update)
    errors.push(
      [404, 'USER_NOT_FOUND', 'User not found'],
      [
        409,
        'ADMIN_ACCOUNT_PROTECTED',
        'Administrator accounts cannot be changed',
      ],
    );
  return applyDecorators(
    ...errors.map(([status, code, message]) =>
      ApiResponse({
        status,
        headers:
          status === 401
            ? {
                ...headers,
                'WWW-Authenticate': {
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
            ...(status === 400 ? ['fieldErrors'] : []),
          ],
          properties: {
            statusCode: { type: 'integer', example: status },
            code: { type: 'string', example: code },
            message: { type: 'string', example: message },
            ...(status === 400
              ? {
                  fieldErrors: {
                    type: 'object' as const,
                    additionalProperties: {
                      type: 'array' as const,
                      items: { type: 'string' as const },
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
@ApiTags('Admin users')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
@UseFilters(AdminUsersFilter)
@Controller('admin/users')
export class AdminUsersController {
  constructor(private readonly users: AdminUsersService) {}
  @Get()
  @ApiOperation({
    summary: 'Search accounts and inspect enabled status',
    description:
      'ADMIN only. Includes USER/ADMIN and both statuses. Literal case-insensitive name/email substring; trims search. Read-only consistent count/page; newest creation then ID descending. Never selects password hashes.',
  })
  @ApiQuery({
    name: 'page',
    required: false,
    type: Number,
    minimum: 1,
    maximum: 2147483647,
    example: 1,
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    minimum: 1,
    maximum: 100,
    example: 25,
  })
  @ApiQuery({
    name: 'search',
    required: false,
    type: String,
    maxLength: 200,
    example: 'learner',
  })
  @ApiQuery({ name: 'status', required: false, enum: ['enabled', 'disabled'] })
  @ApiResponse({ status: 200, type: AdminUserPageDto, headers })
  @responses()
  list(
    @Query(new UserListPipe()) query: UserListQuery,
  ): Promise<AdminUserPageDto> {
    return this.users.list(query);
  }

  @Patch(':id/status')
  @ApiOperation({
    summary: 'Enable or disable a USER account',
    description:
      'ADMIN targets (including yourself) are protected. Disabling atomically revokes all unrevoked sessions and preserves bookings. Enabling requires fresh login; no credential is issued or resurrected. Repeated status changes are safe; no automatic retry.',
  })
  @ApiParam({ name: 'id', format: 'uuid', type: String })
  @ApiBody({ type: UserStatusDto })
  @ApiResponse({ status: 200, type: AdminUserDto, headers })
  @responses(true)
  update(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('id', new UserIdPipe()) id: string,
    @Body(new UserStatusPipe()) body: { isEnabled: boolean },
  ): Promise<AdminUserDto> {
    return this.users.update(principal, id, body.isEnabled);
  }
}
