import { Body, Controller, Post, UseFilters, UseGuards } from '@nestjs/common';
import {
  ApiProperty,
  ApiResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ThrottlerGuard } from '@nestjs/throttler';
import { AuthService } from './auth.service.js';
import type { RegisteredUser } from './auth.service.js';
import { RegisterDto } from './register.dto.js';
import { RegistrationFilter } from './registration.filter.js';

class RegisteredUserDto implements RegisteredUser {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ example: 'Sample learner' }) displayName: string;
  @ApiProperty({ example: 'learner@example.test', format: 'email' })
  email: string;
  @ApiProperty({ enum: ['USER'] }) role: 'USER';
}
const failures = [
  [400, 'VALIDATION_FAILED', 'Invalid registration data'],
  [409, 'EMAIL_ALREADY_EXISTS', 'An account with this email already exists'],
  [
    429,
    'RATE_LIMITED',
    'Too many registration attempts. Please try again later.',
  ],
  [503, 'DATABASE_UNAVAILABLE', 'Database unavailable'],
  [500, 'INTERNAL_ERROR', 'Unable to create account'],
] as const;

@ApiTags('Auth')
@Controller('auth')
@UseFilters(RegistrationFilter)
export class AuthController {
  constructor(private readonly auth: AuthService) {}
  @Post('register')
  @UseGuards(ThrottlerGuard)
  @ApiOperation({
    summary: 'Create an account',
    description:
      'Normalizes email and display name, hashes the unchanged password, and creates an enabled USER. Does not sign in. Limited to five attempts per minute per request IP.',
  })
  @ApiResponse({ status: 201, type: RegisteredUserDto })
  @ApiResponse({
    status: failures[0][0],
    description: failures[0][1],
    schema: {
      type: 'object',
      required: ['statusCode', 'code', 'message', 'fieldErrors'],
      properties: {
        statusCode: { type: 'integer', example: 400 },
        code: { type: 'string', example: 'VALIDATION_FAILED' },
        message: { type: 'string', example: 'Invalid registration data' },
        fieldErrors: {
          type: 'object',
          additionalProperties: { type: 'array', items: { type: 'string' } },
          example: { email: ['email must be an email'] },
        },
      },
    },
  })
  @ApiResponse({
    status: 409,
    schema: errorSchema(409, failures[1][1], failures[1][2]),
  })
  @ApiResponse({
    status: 429,
    schema: errorSchema(429, failures[2][1], failures[2][2]),
  })
  @ApiResponse({
    status: 503,
    schema: errorSchema(503, failures[3][1], failures[3][2]),
  })
  @ApiResponse({
    status: 500,
    schema: errorSchema(500, failures[4][1], failures[4][2]),
  })
  register(@Body() input: RegisterDto): Promise<RegisteredUser> {
    return this.auth.register(input);
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
