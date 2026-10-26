import { Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { RegistrationError } from './registration-error.js';

@Injectable()
export class LoginOriginGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}
  canActivate(context: ExecutionContext): boolean {
    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    http.getResponse<Response>().setHeader('Cache-Control', 'no-store');
    const origins: string[] = [],
      referers: string[] = [];
    for (let i = 0; i < request.rawHeaders.length; i += 2) {
      const name = request.rawHeaders[i].toLowerCase();
      if (name === 'origin') origins.push(request.rawHeaders[i + 1]);
      if (name === 'referer') referers.push(request.rawHeaders[i + 1]);
    }
    try {
      if (origins.length > 1 || referers.length > 1) throw new Error();
      const candidate = origins.length ? origins[0] : referers[0];
      if (!candidate) throw new Error();
      const parsed = new URL(candidate);
      if (
        parsed.username ||
        parsed.password ||
        !['http:', 'https:'].includes(parsed.protocol)
      )
        throw new Error();
      if (origins.length && candidate !== parsed.origin) throw new Error();
      if (
        !this.config
          .getOrThrow<string[]>('AUTH_ALLOWED_ORIGINS')
          .includes(parsed.origin)
      )
        throw new Error();
      return true;
    } catch {
      throw new RegistrationError(
        403,
        'ORIGIN_NOT_ALLOWED',
        'Request origin not allowed',
      );
    }
  }
}
