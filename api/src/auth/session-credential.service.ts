import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { AuthRefreshTokenEntity } from './auth-refresh-token.entity.js';
import { AuthSessionEntity } from './auth-session.entity.js';
import { UserEntity } from '../users/user.entity.js';
import {
  AccessTokenService,
  ACCESS_TOKEN_SECONDS,
} from './access-token.service.js';
import { RefreshTokenService } from './refresh-token.service.js';
import { RegistrationError } from './registration-error.js';
import { unauthorized } from './session-authentication.service.js';
import { refreshDigest } from './refresh-credential.js';
import type { InternalLoginResult } from './login.service.js';

@Injectable()
export class SessionCredentialService {
  constructor(
    @InjectRepository(AuthRefreshTokenEntity)
    private readonly credentials: Repository<AuthRefreshTokenEntity>,
    private readonly database: DataSource,
    private readonly tokens: AccessTokenService,
    private readonly refreshTokens: RefreshTokenService,
  ) {}

  private async execute(
    raw: string | null,
    logout: boolean,
  ): Promise<InternalLoginResult | null> {
    if (!raw) return null;
    const hash = refreshDigest(raw);
    try {
      // This read locates IDs only. None of its eligibility state is trusted.
      const located = await this.credentials
        .createQueryBuilder('credential')
        .innerJoinAndSelect('credential.session', 'session')
        .where('credential.tokenHash = :hash', { hash })
        .getOne();
      if (!located) return null;
      return await this.database.transaction(async (manager) => {
        // All session lifecycle operations acquire locks in this order.
        const user = await manager.getRepository(UserEntity).findOne({
          where: { id: located.session.userId },
          lock: { mode: 'pessimistic_write' },
        });
        if (!user) return null;
        const sessions = manager.getRepository(AuthSessionEntity);
        const session = await sessions.findOne({
          where: { id: located.sessionId, userId: user.id },
          lock: { mode: 'pessimistic_write' },
        });
        if (!session) return null;
        const credentials = manager.getRepository(AuthRefreshTokenEntity);
        const credential = await credentials.findOne({
          where: { id: located.id, sessionId: session.id, tokenHash: hash },
          lock: { mode: 'pessimistic_write' },
        });
        if (!credential) return null;
        const now = new Date();
        if (logout || credential.consumedAt !== null) {
          if (session.revokedAt === null)
            await sessions.update(session.id, { revokedAt: now });
          // Return a denial outcome: throwing here would undo revocation.
          return null;
        }
        if (
          !user.isEnabled ||
          session.revokedAt !== null ||
          session.expiresAt.getTime() <= now.getTime()
        )
          return null;
        let replacement: { raw: string; hash: string };
        try {
          replacement = this.refreshTokens.generate();
        } catch {
          throw new RegistrationError(
            500,
            'INTERNAL_ERROR',
            'Unable to refresh session',
          );
        }
        await credentials.update(credential.id, { consumedAt: now });
        await credentials.insert({
          id: randomUUID(),
          sessionId: session.id,
          tokenHash: replacement.hash,
          createdAt: now,
          consumedAt: null,
        });
        let accessToken: string;
        try {
          accessToken = await this.tokens.sign(user.id, session.id);
        } catch {
          throw new RegistrationError(
            500,
            'INTERNAL_ERROR',
            'Unable to refresh session',
          );
        }
        return {
          refreshToken: replacement.raw,
          sessionExpiresAt: session.expiresAt,
          profile: {
            accessToken,
            tokenType: 'Bearer',
            expiresIn: ACCESS_TOKEN_SECONDS,
            user: {
              id: user.id,
              displayName: user.displayName,
              email: user.email,
              role: user.role,
            },
          },
        };
      });
    } catch (error) {
      if (error instanceof RegistrationError) throw error;
      throw new RegistrationError(
        503,
        'DATABASE_UNAVAILABLE',
        'Database unavailable',
      );
    }
  }
  async refresh(raw: string | null): Promise<InternalLoginResult> {
    const result = await this.execute(raw, false);
    if (!result) throw unauthorized();
    return result;
  }
  async logout(raw: string | null): Promise<void> {
    await this.execute(raw, true);
  }
}
