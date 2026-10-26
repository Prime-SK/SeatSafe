import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { UserEntity } from '../users/user.entity.js';
import { AuthSessionEntity } from './auth-session.entity.js';
import { PasswordHasher } from './password-hasher.js';
import { RegistrationError } from './registration-error.js';
import {
  AccessTokenService,
  ACCESS_TOKEN_SECONDS,
  SESSION_SECONDS,
} from './access-token.service.js';
import type { LoginDto } from './login.dto.js';
import { RefreshTokenService } from './refresh-token.service.js';
import { AuthRefreshTokenEntity } from './auth-refresh-token.entity.js';

export interface InternalLoginResult {
  profile: LoginResult;
  refreshToken: string;
  sessionExpiresAt: Date;
}

export interface LoginResult {
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
  user: {
    id: string;
    displayName: string;
    email: string;
    role: 'USER' | 'ADMIN';
  };
}

@Injectable()
export class LoginService {
  constructor(
    @InjectRepository(UserEntity)
    private readonly users: Repository<UserEntity>,
    private readonly passwords: PasswordHasher,
    private readonly database: DataSource,
    private readonly tokens: AccessTokenService,
    private readonly refresh: RefreshTokenService,
  ) {}
  private invalid(): RegistrationError {
    return new RegistrationError(
      401,
      'INVALID_CREDENTIALS',
      'Invalid email or password',
    );
  }
  async login(input: LoginDto): Promise<InternalLoginResult> {
    let user: UserEntity | null;
    try {
      user = await this.users
        .createQueryBuilder('user')
        .addSelect('user.passwordHash')
        .where('user.email = :email', { email: input.email })
        .getOne();
    } catch {
      throw new RegistrationError(
        503,
        'DATABASE_UNAVAILABLE',
        'Database unavailable',
      );
    }
    let valid: boolean;
    try {
      valid = await this.passwords.verify(
        user?.passwordHash ?? PasswordHasher.dummyHash,
        input.password,
      );
    } catch {
      throw new RegistrationError(500, 'INTERNAL_ERROR', 'Unable to sign in');
    }
    if (!user || !valid || !user.isEnabled) throw this.invalid();
    const verifiedUser = user;
    try {
      return await this.database.transaction(async (manager) => {
        // Every read/write inside the transaction uses its own manager.
        const current = await manager
          .getRepository(UserEntity)
          .createQueryBuilder('user')
          .setLock('pessimistic_write')
          .where('user.id = :id', { id: verifiedUser.id })
          .getOne();
        if (!current || !current.isEnabled) throw this.invalid();
        const now = new Date();
        const sessionId = randomUUID();
        const sessionExpiresAt = new Date(
          now.getTime() + SESSION_SECONDS * 1000,
        );
        let credential: { raw: string; hash: string };
        try {
          credential = this.refresh.generate();
        } catch {
          throw new RegistrationError(
            500,
            'INTERNAL_ERROR',
            'Unable to sign in',
          );
        }
        await manager.getRepository(AuthSessionEntity).insert({
          id: sessionId,
          userId: current.id,
          createdAt: now,
          expiresAt: sessionExpiresAt,
          revokedAt: null,
        });
        await manager.getRepository(AuthRefreshTokenEntity).insert({
          id: randomUUID(),
          sessionId,
          tokenHash: credential.hash,
          createdAt: now,
          consumedAt: null,
        });
        let accessToken: string;
        try {
          accessToken = await this.tokens.sign(current.id, sessionId);
        } catch {
          throw new RegistrationError(
            500,
            'INTERNAL_ERROR',
            'Unable to sign in',
          );
        }
        return {
          refreshToken: credential.raw,
          sessionExpiresAt,
          profile: {
            accessToken,
            tokenType: 'Bearer',
            expiresIn: ACCESS_TOKEN_SECONDS,
            user: {
              id: current.id,
              displayName: current.displayName,
              email: current.email,
              role: current.role,
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
}
