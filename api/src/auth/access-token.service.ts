import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { isUUID } from 'class-validator';

export interface AccessTokenClaims {
  sub: string;
  sid: string;
  iat: number;
  exp: number;
}

export const ACCESS_TOKEN_SECONDS = 900;
export const SESSION_SECONDS = 7 * 24 * 60 * 60;

export function validateJwtSecret(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    Buffer.byteLength(value, 'utf8') < 32
  ) {
    throw new Error(
      'JWT_SECRET must be a nonblank string of at least 32 bytes',
    );
  }
  return value;
}

@Injectable()
export class AccessTokenService {
  constructor(private readonly jwt: JwtService) {}
  async verify(token: string): Promise<AccessTokenClaims> {
    const claims: unknown = await this.jwt.verifyAsync(token, {
      algorithms: ['HS256'],
    });
    if (!claims || typeof claims !== 'object' || Array.isArray(claims))
      throw new Error('Invalid access token claims');
    const value = claims as Record<string, unknown>;
    if (
      typeof value.sub !== 'string' ||
      !isUUID(value.sub) ||
      typeof value.sid !== 'string' ||
      !isUUID(value.sid) ||
      !Number.isSafeInteger(value.iat) ||
      !Number.isSafeInteger(value.exp) ||
      Number(value.exp) <= Number(value.iat)
    )
      throw new Error('Invalid access token claims');
    return {
      sub: value.sub,
      sid: value.sid,
      iat: Number(value.iat),
      exp: Number(value.exp),
    };
  }
  sign(userId: string, sessionId: string): Promise<string> {
    return this.jwt.signAsync(
      { sub: userId, sid: sessionId },
      { algorithm: 'HS256', expiresIn: ACCESS_TOKEN_SECONDS },
    );
  }
}
