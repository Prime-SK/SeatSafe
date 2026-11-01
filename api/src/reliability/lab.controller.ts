import {
  Body,
  Catch,
  Controller,
  Get,
  HttpCode,
  HttpException,
  Injectable,
  Param,
  Post,
  UseFilters,
  UseGuards,
  Query,
  applyDecorators,
} from '@nestjs/common';
import type {
  ArgumentsHost,
  CanActivate,
  ExecutionContext,
  ExceptionFilter,
  PipeTransform,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiProperty,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { isUUID } from 'class-validator';
import { Roles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthenticatedPrincipal } from '../auth/authenticated-request.js';
import { RegistrationError } from '../auth/registration-error.js';
import { LabService } from './lab.service.js';
import { scenarios } from './lab.types.js';
import type { LabReport, LabScenario } from './lab.types.js';
@Catch()
export class LabFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    response.setHeader('Cache-Control', 'no-store');
    if (error instanceof HttpException) {
      if (error.getStatus() === 401)
        response.setHeader('WWW-Authenticate', 'Bearer');
      response.status(error.getStatus()).json(error.getResponse());
    } else
      response.status(500).json({
        statusCode: 500,
        code: 'INTERNAL_ERROR',
        message: 'Unable to process lab request',
      });
  }
}
@Injectable()
export class LabLocalGuard implements CanActivate {
  constructor(private readonly lab: LabService) {}
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (
      !this.lab.enabled() ||
      !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(
        request.socket.remoteAddress ?? '',
      )
    )
      throw new RegistrationError(
        404,
        'LAB_UNAVAILABLE',
        'Reliability lab is unavailable',
      );
    return true;
  }
}
const invalid = (field: string) =>
  new RegistrationError(400, 'VALIDATION_FAILED', 'Invalid lab request', {
    [field]: ['Supply a valid run UUID and one supported scenario only'],
  });
class LabStartPipe implements PipeTransform {
  transform(value: unknown): { runId: string; scenario: LabScenario } {
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      Object.keys(value).sort().join(',') !== 'runId,scenario' ||
      !('runId' in value) ||
      typeof value.runId !== 'string' ||
      !isUUID(value.runId) ||
      !('scenario' in value) ||
      !scenarios.includes(value.scenario as LabScenario)
    )
      throw invalid('body');
    return value as { runId: string; scenario: LabScenario };
  }
}
class LabIdPipe implements PipeTransform {
  transform(value: string): string {
    if (!isUUID(value)) throw invalid('runId');
    return value;
  }
}
class LabQueryPipe implements PipeTransform {
  transform(value: Record<string, unknown>) {
    if (Object.keys(value).length) throw invalid('query');
    return value;
  }
}
function labFailures(kind: 'capabilities' | 'start' | 'read') {
  const values: [number, string, string][] = [
    [400, 'VALIDATION_FAILED', 'Invalid lab request'],
    [401, 'UNAUTHORIZED', 'Authentication required'],
    [403, 'FORBIDDEN', 'Insufficient permissions'],
    [500, 'INTERNAL_ERROR', 'Unable to process lab request'],
    [503, 'DATABASE_UNAVAILABLE', 'Database unavailable'],
  ];
  if (kind !== 'capabilities')
    values.push([
      404,
      'LAB_RUN_NOT_FOUND / LAB_UNAVAILABLE',
      'Lab run not found / Reliability lab is unavailable',
    ]);
  if (kind === 'start')
    values.push([
      409,
      'LAB_BUSY / LAB_RUN_CONFLICT',
      'The reliability lab is busy / Run ID was already used for another scenario',
    ]);
  return applyDecorators(
    ...values.map(([status, code, message]) =>
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
class LabStartDto {
  @ApiProperty({
    format: 'uuid',
    example: '11111111-1111-4111-8111-111111111111',
  })
  runId: string;
  @ApiProperty({ enum: scenarios, example: 'matching-key' })
  scenario: LabScenario;
}
class LabCapabilitiesDto {
  @ApiProperty({ example: true }) enabled: boolean;
  @ApiProperty({ enum: scenarios, isArray: true })
  scenarios: readonly LabScenario[];
}
const headers = {
  'Cache-Control': { schema: { type: 'string', example: 'no-store' } },
};
// Report properties are explicit OpenAPI fields; no synthetic credentials appear in the wire model.
const reportSchema = {
  type: 'object' as const,
  properties: {
    runId: {
      type: 'string' as const,
      format: 'uuid',
      example: '11111111-1111-4111-8111-111111111111',
    },
    scenario: {
      type: 'string' as const,
      enum: [...scenarios],
      example: 'matching-key',
    },
    status: {
      type: 'string' as const,
      enum: ['running', 'completed', 'failed', 'incomplete'],
    },
    stage: {
      type: 'string' as const,
      enum: ['preparing', 'executing', 'cleaning', 'finished'],
    },
    startedAt: { type: 'string' as const, format: 'date-time' },
    completedAt: {
      type: 'string' as const,
      format: 'date-time',
      nullable: true,
    },
    postgres: { type: 'string' as const, nullable: true },
    isolation: { type: 'string' as const, nullable: true },
    ...Object.fromEntries(
      [
        'requested',
        'workers',
        'successes',
        'timeouts',
        'unexpected',
        'undispatched',
        'capacity',
        'activeBookings',
        'reservedSeats',
        'idempotencyRecords',
        'uniqueBookings',
      ].map((name) => [
        name,
        {
          type: 'integer' as const,
          nullable: [
            'activeBookings',
            'reservedSeats',
            'idempotencyRecords',
          ].includes(name),
        },
      ]),
    ),
    conflicts: {
      type: 'object' as const,
      additionalProperties: { type: 'integer' as const },
    },
    matchingSnapshots: { type: 'boolean' as const },
    invariantsPassed: { type: 'boolean' as const },
    cleanup: {
      type: 'string' as const,
      enum: ['pending', 'removed', 'failed'],
    },
    message: { type: 'string' as const },
    attempts: {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        properties: {
          attempt: { type: 'integer' as const },
          userLabel: { type: 'string' as const },
          outcome: {
            type: 'string' as const,
            enum: [
              'success',
              'conflict',
              'timeout',
              'unexpected',
              'undispatched',
            ],
          },
          code: { type: 'string' as const },
        },
      },
    },
  },
};
@ApiTags('Local reliability lab')
@ApiBearerAuth('access-token')
@UseFilters(LabFilter)
@Controller('admin/reliability')
export class LabController {
  constructor(private readonly lab: LabService) {}
  @labFailures('capabilities')
  @Get('capabilities')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @ApiOperation({
    summary: 'Read local reliability lab availability',
    description:
      'ADMIN only. Disabled by default; execution requires explicit development/local database configuration. No fixtures are created.',
  })
  @ApiResponse({ status: 200, type: LabCapabilitiesDto, headers })
  @ApiResponse({
    status: 401,
    description: 'UNAUTHORIZED; WWW-Authenticate: Bearer',
  })
  @ApiResponse({ status: 403, description: 'FORBIDDEN' })
  @ApiResponse({ status: 503, description: 'DATABASE_UNAVAILABLE' })
  capabilities(@Query(new LabQueryPipe()) _query: Record<string, unknown>) {
    return {
      enabled: this.lab.enabled(),
      scenarios: this.lab.enabled() ? scenarios : [],
    };
  }
  @labFailures('start')
  @Post('runs')
  @HttpCode(202)
  @UseGuards(LabLocalGuard, JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @ApiOperation({
    summary: 'Start fixed isolated internal booking-service attempts',
    description:
      'Not HTTP reservation traffic. One active run per process; at most ten lab connections. Matching retained owner/run/scenario reuses its report; no durable result history. Cleanup must succeed before completed. Does not accept schema names, account IDs or SQL.',
  })
  @ApiBody({ type: LabStartDto })
  @ApiResponse({ status: 202, schema: reportSchema, headers })
  @ApiResponse({ status: 400, description: 'VALIDATION_FAILED' })
  @ApiResponse({
    status: 401,
    description: 'UNAUTHORIZED; WWW-Authenticate: Bearer',
  })
  @ApiResponse({ status: 403, description: 'FORBIDDEN' })
  @ApiResponse({
    status: 404,
    description: 'LAB_UNAVAILABLE when disabled or non-loopback',
  })
  @ApiResponse({ status: 409, description: 'LAB_BUSY or LAB_RUN_CONFLICT' })
  @ApiResponse({ status: 503, description: 'DATABASE_UNAVAILABLE' })
  @ApiResponse({ status: 500, description: 'INTERNAL_ERROR' })
  start(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Body(new LabStartPipe()) body: { runId: string; scenario: LabScenario },
  ): LabReport {
    return this.lab.start(user.id, body.runId, body.scenario);
  }
  @labFailures('read')
  @Get('runs/:runId')
  @UseGuards(LabLocalGuard, JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @ApiOperation({
    summary: 'Read the caller’s retained lab report',
    description:
      'Unknown, evicted and foreign-owned IDs share LAB_RUN_NOT_FOUND. Reports are ephemeral and contain synthetic labels, not credentials.',
  })
  @ApiParam({
    name: 'runId',
    format: 'uuid',
    example: '11111111-1111-4111-8111-111111111111',
  })
  @ApiResponse({ status: 200, schema: reportSchema, headers })
  @ApiResponse({ status: 400, description: 'VALIDATION_FAILED' })
  @ApiResponse({
    status: 401,
    description: 'UNAUTHORIZED; WWW-Authenticate: Bearer',
  })
  @ApiResponse({ status: 403, description: 'FORBIDDEN' })
  @ApiResponse({
    status: 404,
    description: 'LAB_UNAVAILABLE or LAB_RUN_NOT_FOUND',
  })
  @ApiResponse({ status: 503, description: 'DATABASE_UNAVAILABLE' })
  @ApiResponse({ status: 500, description: 'INTERNAL_ERROR' })
  read(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('runId', new LabIdPipe()) id: string,
    @Query(new LabQueryPipe()) _query: Record<string, unknown>,
  ): LabReport {
    return this.lab.read(user.id, id);
  }
}
