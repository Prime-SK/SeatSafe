import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

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
  sign(userId: string, sessionId: string): Promise<string> {
    return this.jwt.signAsync(
      { sub: userId, sid: sessionId },
      { algorithm: 'HS256', expiresIn: ACCESS_TOKEN_SECONDS },
    );
  }
}
