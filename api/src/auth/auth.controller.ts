import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Post,
  Res,
  Req,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import {
  ApiProperty,
  ApiResponse,
  ApiOperation,
  ApiTags,
  ApiBearerAuth,
  ApiCookieAuth,
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
import type { Request, Response } from 'express';
import { LoginOriginGuard } from './login-origin.guard.js';
import { RefreshCookieService } from './refresh-cookie.service.js';
import { SessionCredentialService } from './session-credential.service.js';
import { SessionCredentialFilter } from './session-credential.filter.js';
import { readRefreshCredential } from './refresh-credential.js';

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
    private readonly refreshCookie: RefreshCookieService,
    private readonly sessionCredentials: SessionCredentialService,
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
  @UseGuards(LoginOriginGuard, ThrottlerGuard)
  @ApiOperation({
    summary: 'Sign in',
    description:
      'Requires an allowed Origin or Referer. Creates an independent seven-day session and HttpOnly refresh cookie; returns a 15-minute access token. Use refresh to rotate the cookie and logout to revoke its session. Limited to five attempts per minute per IP independently of registration.',
  })
  @ApiResponse({
    status: 200,
    type: LoginResultDto,
    headers: {
      'Set-Cookie': {
        description:
          'seatsafe_refresh=<opaque credential>; Path=/api/auth; HttpOnly; SameSite=Lax; expires with session; Secure in production. Not exposed to browser JavaScript.',
        schema: { type: 'string' },
      },
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
  @ApiResponse({
    status: 403,
    schema: errorSchema(
      403,
      'ORIGIN_NOT_ALLOWED',
      'Request origin not allowed',
    ),
  })
  async login(
    @Body() input: LoginDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<LoginResult> {
    const result = await this.loginService.login(input);
    this.refreshCookie.set(
      response,
      result.refreshToken,
      result.sessionExpiresAt,
    );
    const { accessToken, tokenType, expiresIn, user } = result.profile;
    return { accessToken, tokenType, expiresIn, user };
  }
  @Post('refresh')
  @HttpCode(200)
  @UseFilters(SessionCredentialFilter)
  @UseGuards(LoginOriginGuard, ThrottlerGuard)
  @ApiCookieAuth('refresh-cookie')
  @ApiOperation({
    summary: 'Rotate refresh credential',
    description:
      'Requires an allowed Origin or Referer and exactly one seatsafe_refresh cookie. Browsers obtain the HttpOnly cookie through login, not Swagger Cookie input. Rotates within the original seven-day session. Reuse of a consumed credential revokes that session, including simultaneous duplicate refreshes. Body, query and Bearer credentials are ignored.',
  })
  @ApiResponse({
    status: 200,
    type: LoginResultDto,
    headers: {
      ...noStoreHeaders,
      'Set-Cookie': {
        description:
          'Replacement HttpOnly seatsafe_refresh cookie with original session expiry.',
        schema: { type: 'string' },
      },
    },
  })
  @ApiResponse({
    status: 401,
    schema: errorSchema(401, 'UNAUTHORIZED', 'Authentication required'),
    headers: {
      ...noStoreHeaders,
      'Set-Cookie': {
        description: 'Expires the stale seatsafe_refresh cookie.',
        schema: { type: 'string' },
      },
    },
  })
  @ApiResponse({
    status: 403,
    schema: errorSchema(
      403,
      'ORIGIN_NOT_ALLOWED',
      'Request origin not allowed',
    ),
    headers: noStoreHeaders,
  })
  @ApiResponse({
    status: 429,
    schema: errorSchema(
      429,
      'RATE_LIMITED',
      'Too many refresh attempts. Please try again later.',
    ),
    headers: noStoreHeaders,
  })
  @ApiResponse({
    status: 500,
    schema: errorSchema(500, 'INTERNAL_ERROR', 'Unable to refresh session'),
    headers: noStoreHeaders,
  })
  @ApiResponse({
    status: 503,
    schema: errorSchema(503, 'DATABASE_UNAVAILABLE', 'Database unavailable'),
    headers: noStoreHeaders,
  })
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<LoginResult> {
    const result = await this.sessionCredentials.refresh(
      readRefreshCredential(request),
    );
    this.refreshCookie.set(
      response,
      result.refreshToken,
      result.sessionExpiresAt,
    );
    const { accessToken, tokenType, expiresIn, user } = result.profile;
    return { accessToken, tokenType, expiresIn, user };
  }
  @Post('logout')
  @HttpCode(204)
  @UseFilters(SessionCredentialFilter)
  @UseGuards(LoginOriginGuard, ThrottlerGuard)
  @ApiOperation({
    summary: 'Revoke the cookie session and clear its cookie',
    description:
      'Requires an allowed Origin or Referer. Optional seatsafe_refresh cookie identifies only the session to revoke, including consumed credentials. Missing, malformed, duplicate, unknown or already revoked credentials still return 204. No Bearer access token is required. Database failure retains the cookie for retry.',
  })
  @ApiResponse({
    status: 204,
    description: 'Idempotent logout; no response body.',
    headers: {
      ...noStoreHeaders,
      'Set-Cookie': {
        description:
          'Expires seatsafe_refresh with matching cookie scope/options.',
        schema: { type: 'string' },
      },
    },
  })
  @ApiResponse({
    status: 403,
    schema: errorSchema(
      403,
      'ORIGIN_NOT_ALLOWED',
      'Request origin not allowed',
    ),
    headers: noStoreHeaders,
  })
  @ApiResponse({
    status: 429,
    schema: errorSchema(
      429,
      'RATE_LIMITED',
      'Too many logout attempts. Please try again later.',
    ),
    headers: noStoreHeaders,
  })
  @ApiResponse({
    status: 503,
    schema: errorSchema(503, 'DATABASE_UNAVAILABLE', 'Database unavailable'),
    headers: noStoreHeaders,
  })
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.sessionCredentials.logout(readRefreshCredential(request));
    this.refreshCookie.clear(response);
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
