import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';

@Injectable()
export class RefreshCookieService {
  constructor(private readonly config: ConfigService) {}
  clear(response: Response): void {
    response.clearCookie('seatsafe_refresh', {
      httpOnly: true,
      sameSite: 'lax',
      path: '/api/auth',
      secure: this.config.get<string>('NODE_ENV') === 'production',
    });
  }
  set(response: Response, raw: string, expiresAt: Date): void {
    response.cookie('seatsafe_refresh', raw, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/api/auth',
      secure: this.config.get<string>('NODE_ENV') === 'production',
      expires: expiresAt,
      maxAge: Math.max(0, expiresAt.getTime() - Date.now()),
    });
  }
}
