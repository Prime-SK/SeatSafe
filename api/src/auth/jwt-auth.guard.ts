import { Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import type { Response } from 'express';
import { AccessTokenService } from './access-token.service.js';
import {
  SessionAuthenticationService,
  unauthorized,
} from './session-authentication.service.js';
import type { AuthenticatedRequest } from './authenticated-request.js';
import { RegistrationError } from './registration-error.js';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly tokens: AccessTokenService,
    private readonly sessions: SessionAuthenticationService,
  ) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const request = http.getRequest<AuthenticatedRequest>();
    const response = http.getResponse<Response>();
    response.setHeader('Cache-Control', 'no-store');
    // Node may discard duplicate Authorization values in headers; rawHeaders retains them.
    const values: string[] = [];
    for (let index = 0; index < request.rawHeaders.length; index += 2) {
      if (request.rawHeaders[index].toLowerCase() === 'authorization')
        values.push(request.rawHeaders[index + 1]);
    }
    try {
      if (values.length !== 1) throw unauthorized();
      const match =
        /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i.exec(
          values[0],
        );
      if (!match) throw unauthorized();
      const claims = await this.tokens.verify(match[1]);
      request.user = await this.sessions.authenticate(claims.sub, claims.sid);
      return true;
    } catch (error) {
      if (error instanceof RegistrationError && error.getStatus() === 503)
        throw error;
      response.setHeader('WWW-Authenticate', 'Bearer');
      throw unauthorized();
    }
  }
}
