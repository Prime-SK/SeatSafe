import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuthSessionEntity } from './auth-session.entity.js';
import { RegistrationError } from './registration-error.js';
import type { AuthenticatedPrincipal } from './authenticated-request.js';

export function unauthorized(): RegistrationError {
  return new RegistrationError(401, 'UNAUTHORIZED', 'Authentication required');
}

@Injectable()
export class SessionAuthenticationService {
  constructor(
    @InjectRepository(AuthSessionEntity)
    private readonly sessions: Repository<AuthSessionEntity>,
  ) {}
  async authenticate(
    userId: string,
    sessionId: string,
  ): Promise<AuthenticatedPrincipal> {
    let session: AuthSessionEntity | null;
    try {
      session = await this.sessions
        .createQueryBuilder('session')
        .innerJoinAndSelect('session.user', 'user')
        .where('session.id = :sessionId', { sessionId })
        .andWhere('session.userId = :userId', { userId })
        .getOne();
    } catch {
      throw new RegistrationError(
        503,
        'DATABASE_UNAVAILABLE',
        'Database unavailable',
      );
    }
    if (
      !session ||
      !session.user ||
      !session.user.isEnabled ||
      session.revokedAt !== null ||
      session.expiresAt.getTime() <= Date.now()
    )
      throw unauthorized();
    const user = session.user;
    return {
      id: user.id,
      displayName: user.displayName,
      email: user.email,
      role: user.role,
      sessionId: session.id,
    };
  }
}
