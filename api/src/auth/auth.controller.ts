import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Post,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import {
  ApiProperty,
  ApiResponse,
  ApiOperation,
  ApiTags,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { ThrottlerGuard } from '@nestjs/throttler';
import { AuthService } from './auth.service.js';
import type { RegisteredUser } from './auth.service.js';
import { RegisterDto } from './register.dto.js';
import { RegistrationFilter } from './registration.filter.js';
import { LoginDto } from './login.dto.js';
import { LoginService } from './login.service.js';
import type { LoginResult } from './login.service.js';
import { LoginFilter } from './login.filter.js';
import { AccountSummaryDto } from './account-summary.dto.js';
import { CurrentUser } from './current-user.decorator.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import type { AuthenticatedPrincipal } from './authenticated-request.js';

const noStoreHeaders = {
  'Cache-Control': {
    description: 'Do not cache account responses.',
    schema: { type: 'string', example: 'no-store' },
  },
};

class LoginResultDto implements LoginResult {
  @ApiProperty({
    description:
      'Signed HS256 JWT; contains sub, sid, iat and exp. Treat as a credential.',
    example: '<signed-access-token>',
  })
  accessToken: string;
  @ApiProperty({ enum: ['Bearer'] }) tokenType: 'Bearer';
  @ApiProperty({ example: 900 }) expiresIn: number;
  @ApiProperty({ type: AccountSummaryDto }) user: AccountSummaryDto;
}

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
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly loginService: LoginService,
  ) {}
  @Post('register')
  @UseFilters(RegistrationFilter)
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
  @Post('login')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @UseFilters(LoginFilter)
  @UseGuards(ThrottlerGuard)
  @ApiOperation({
    summary: 'Sign in',
    description:
      'Normalizes email, verifies the unchanged password and creates an independent seven-day session. Returns a 15-minute access token. No refresh cookie yet. Limited to five attempts per minute per request IP, independently of registration.',
  })
  @ApiResponse({
    status: 200,
    type: LoginResultDto,
    headers: {
      'Cache-Control': {
        description: 'Do not cache the credential response.',
        schema: { type: 'string', example: 'no-store' },
      },
    },
  })
  @ApiResponse({
    status: 400,
    schema: {
      ...errorSchema(400, 'VALIDATION_FAILED', 'Invalid login data'),
      required: ['statusCode', 'code', 'message', 'fieldErrors'],
      properties: {
        ...errorSchema(400, 'VALIDATION_FAILED', 'Invalid login data')
          .properties,
        fieldErrors: {
          type: 'object',
          additionalProperties: { type: 'array', items: { type: 'string' } },
          example: { email: ['email must be an email'] },
        },
      },
    },
  })
  @ApiResponse({
    status: 401,
    schema: errorSchema(
      401,
      'INVALID_CREDENTIALS',
      'Invalid email or password',
    ),
  })
  @ApiResponse({
    status: 429,
    schema: errorSchema(
      429,
      'RATE_LIMITED',
      'Too many login attempts. Please try again later.',
    ),
  })
  @ApiResponse({
    status: 503,
    schema: errorSchema(503, 'DATABASE_UNAVAILABLE', 'Database unavailable'),
  })
  @ApiResponse({
    status: 500,
    schema: errorSchema(500, 'INTERNAL_ERROR', 'Unable to sign in'),
  })
  login(@Body() input: LoginDto): Promise<LoginResult> {
    return this.loginService.login(input);
  }
  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Read the authenticated account',
    description:
      'Verifies an HS256 access token and reads its current account/session. Rejects disabled accounts and expired/revoked sessions. Does not renew or modify the session.',
  })
  @ApiResponse({
    status: 200,
    type: AccountSummaryDto,
    headers: noStoreHeaders,
  })
  @ApiResponse({
    status: 401,
    schema: errorSchema(401, 'UNAUTHORIZED', 'Authentication required'),
    headers: {
      ...noStoreHeaders,
      'WWW-Authenticate': {
        schema: { type: 'string', example: 'Bearer' },
        description: 'Bearer authentication is required.',
      },
    },
  })
  @ApiResponse({
    status: 503,
    schema: errorSchema(503, 'DATABASE_UNAVAILABLE', 'Database unavailable'),
    headers: noStoreHeaders,
  })
  me(@CurrentUser() user: AuthenticatedPrincipal): AccountSummaryDto {
    return {
      id: user.id,
      displayName: user.displayName,
      email: user.email,
      role: user.role,
    };
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
