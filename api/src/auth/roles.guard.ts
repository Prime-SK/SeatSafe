import { Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthenticatedRequest } from './authenticated-request.js';
import { REQUIRED_ROLES } from './roles.decorator.js';
import type { AccountRole } from './roles.decorator.js';
import { RegistrationError } from './registration-error.js';
import { unauthorized } from './session-authentication.service.js';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const principal = context
      .switchToHttp()
      .getRequest<AuthenticatedRequest>().user;
    if (!principal) throw unauthorized();
    const roles = this.reflector.getAllAndOverride<AccountRole[]>(
      REQUIRED_ROLES,
      [context.getHandler(), context.getClass()],
    );
    if (roles === undefined) return true;
    if (roles.length > 0 && roles.includes(principal.role)) return true;
    throw new RegistrationError(403, 'FORBIDDEN', 'Insufficient permissions');
  }
}
