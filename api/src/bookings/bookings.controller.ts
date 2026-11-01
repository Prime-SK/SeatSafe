import {
  applyDecorators,
  Body,
  Controller,
  Get,
  Header,
  Param,
  Post,
  Query,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiCreatedResponse,
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
import { BookingsService } from './bookings.service.js';
import { BookingsFilter } from './bookings.filter.js';
import {
  BookingPageDto,
  BookingPageQuery,
  BookingResponseDto,
  EmptyBookingBody,
} from './booking.dto.js';
const headers = {
  'Cache-Control': {
    schema: { type: 'string', example: 'no-store' },
    description: 'Do not cache booking responses.',
  },
};
function failures(admin = false) {
  const entries: [number, string, string][] = [
    [
      400,
      'VALIDATION_FAILED',
      admin ? 'Invalid booking query' : 'Invalid booking request',
    ],
    [401, 'UNAUTHORIZED', 'Authentication required'],
    [404, 'WORKSHOP_NOT_FOUND', 'Workshop not found'],
    [503, 'DATABASE_UNAVAILABLE', 'Database unavailable'],
    [
      500,
      'INTERNAL_ERROR',
      admin ? 'Unable to load bookings' : 'Unable to reserve seat',
    ],
  ];
  if (admin) entries.push([403, 'FORBIDDEN', 'Insufficient permissions']);
  const responses = entries.map(([status, code, message]) =>
    ApiResponse({
      status,
      headers:
        status === 401
          ? {
              ...headers,
              'WWW-Authenticate': {
                schema: { type: 'string', example: 'Bearer' },
                description: 'Bearer authentication required.',
              },
            }
          : headers,
      schema: {
        type: 'object',
        required: ['statusCode', 'code', 'message'],
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
  );
  if (!admin)
    responses.push(
      ApiResponse({
        status: 409,
        headers,
        description:
          'ALREADY_BOOKED, REGISTRATION_CLOSED, WORKSHOP_ALREADY_STARTED or WORKSHOP_FULL. No state change.',
        schema: {
          type: 'object',
          required: ['statusCode', 'code', 'message'],
          properties: {
            statusCode: { type: 'integer', example: 409 },
            code: {
              type: 'string',
              enum: [
                'ALREADY_BOOKED',
                'REGISTRATION_CLOSED',
                'WORKSHOP_ALREADY_STARTED',
                'WORKSHOP_FULL',
              ],
            },
            message: { type: 'string', example: 'Workshop is full' },
          },
        },
      }),
    );
  return applyDecorators(...responses);
}
@ApiTags('Bookings')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@UseFilters(BookingsFilter)
@Controller('workshops')
export class BookingsController {
  constructor(private readonly bookings: BookingsService) {}
  @Post(':id/bookings')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Reserve one seat for the authenticated account',
    description:
      'USER and ADMIN may reserve themselves. No body or {} only. Locks user then workshop and commits the booking with its seat count. Duplicate active booking is checked first. No Idempotency-Key semantics yet; never automatically replay this write.',
  })
  @ApiParam({
    name: 'id',
    description: 'Opaque workshop ID, including legacy IDs.',
  })
  @ApiBody({
    required: false,
    schema: { type: 'object', additionalProperties: false, example: {} },
  })
  @ApiCreatedResponse({ type: BookingResponseDto, headers })
  @failures()
  reserve(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedPrincipal,
    @Body(EmptyBookingBody) _body: unknown,
  ) {
    return this.bookings.reserve(user, id);
  }
}
@ApiTags('Admin workshops')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
@UseFilters(BookingsFilter)
@Controller('admin/workshops')
export class AdminBookingsController {
  constructor(private readonly bookings: BookingsService) {}
  @Get(':id/bookings')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'List workshop bookings with current attendee profiles',
    description:
      'ADMIN only. All statuses, creation time then ID ascending. Read-only; counts may change as new reservations arrive.',
  })
  @ApiParam({ name: 'id' })
  @ApiQuery({
    name: 'page',
    required: false,
    schema: { type: 'integer', minimum: 1, maximum: 2147483647, default: 1 },
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    schema: { type: 'integer', minimum: 1, maximum: 100, default: 25 },
    description: '1–100',
  })
  @ApiResponse({ status: 200, type: BookingPageDto, headers })
  @failures(true)
  list(@Param('id') id: string, @Query() query: BookingPageQuery) {
    return this.bookings.list(id, query);
  }
}
