import {
  applyDecorators,
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  Post,
  Query,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthenticatedPrincipal } from '../auth/authenticated-request.js';
import {
  BookingIdParams,
  BookingPageQuery,
  BookingResponseDto,
  EmptyBookingBody,
} from './booking.dto.js';
import { MyBookingPageDto } from './my-bookings.dto.js';
import { BookingsService } from './bookings.service.js';
import { BookingsFilter } from './bookings.filter.js';

const headers = {
  'Cache-Control': {
    schema: { type: 'string', example: 'no-store' },
    description: 'Do not cache private booking responses.',
  },
};
function failures(cancel = false) {
  const entries: [number, string, string][] = [
    [
      400,
      'VALIDATION_FAILED',
      cancel ? 'Invalid booking request' : 'Invalid booking query',
    ],
    [401, 'UNAUTHORIZED', 'Authentication required'],
    [503, 'DATABASE_UNAVAILABLE', 'Database unavailable'],
    [
      500,
      'INTERNAL_ERROR',
      cancel ? 'Unable to cancel booking' : 'Unable to load bookings',
    ],
  ];
  if (cancel) entries.push([404, 'BOOKING_NOT_FOUND', 'Booking not found']);
  return applyDecorators(
    ...entries.map(([status, code, message]) =>
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
    ),
  );
}
@ApiTags('My bookings')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@UseFilters(BookingsFilter)
@Controller('bookings')
export class MyBookingsController {
  constructor(private readonly bookings: BookingsService) {}
  @Get('me')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Read your booking history',
    description:
      'USER and ADMIN read only their own ACTIVE and CANCELLED bookings, newest creation time then ID descending. Workshop fields are current values. Read-only: no session renewal or writes. Unknown query fields are rejected.',
  })
  @ApiQuery({
    name: 'page',
    required: false,
    schema: { type: 'integer', minimum: 1, maximum: 2147483647, default: 1 },
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    schema: { type: 'integer', minimum: 1, maximum: 100, default: 25 },
  })
  @ApiOkResponse({ type: MyBookingPageDto, headers })
  @failures()
  mine(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Query() query: BookingPageQuery,
  ) {
    return this.bookings.mine(user, query);
  }
  @Post(':id/cancel')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Cancel your booking once',
    description:
      'Cancel at any time, including after start or registration closure. Repeated cancellation returns the same stored cancellation timestamp and releases no additional seat. Unknown and foreign-owned UUIDs both return BOOKING_NOT_FOUND. No Idempotency-Key required or stored; reservation snapshots remain unchanged. Locks user, workshop, then booking and commits before response. No automatic retries.',
  })
  @ApiParam({
    name: 'id',
    schema: { type: 'string', format: 'uuid' },
    description: 'Your booking UUID.',
  })
  @ApiBody({
    required: false,
    schema: { type: 'object', additionalProperties: false, example: {} },
  })
  @ApiOkResponse({ type: BookingResponseDto, headers })
  @failures(true)
  cancel(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param() params: BookingIdParams,
    @Body(EmptyBookingBody) _body: unknown,
  ) {
    return this.bookings.cancel(user, params.id);
  }
}
