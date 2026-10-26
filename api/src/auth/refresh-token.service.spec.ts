import { createHash } from 'node:crypto';
import { RefreshTokenService } from './refresh-token.service.js';
import { RefreshCookieService } from './refresh-cookie.service.js';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';

describe('Refresh credential issuance', () => {
  it('generates distinct 256-bit credentials with matching SHA-256 hashes', () => {
    const service = new RefreshTokenService();
    const credentials = Array.from({ length: 32 }, () => service.generate());
    expect(new Set(credentials.map((value) => value.raw)).size).toBe(32);
    for (const credential of credentials) {
      expect(credential.raw).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(Buffer.from(credential.raw, 'base64url')).toHaveLength(32);
      expect(credential.hash).toBe(
        createHash('sha256').update(credential.raw).digest('hex'),
      );
    }
  });
  it.each(['development', 'production'])(
    'sets fixed expiry and environment-specific Secure in %s',
    (environment) => {
      const cookie = vi.fn();
      const expires = new Date(Date.now() + 600000);
      new RefreshCookieService(
        new ConfigService({ NODE_ENV: environment }),
      ).set({ cookie } as unknown as Response, 'public-fixture', expires);
      const options = cookie.mock.calls[0][2];
      expect(options).toMatchObject({
        httpOnly: true,
        sameSite: 'lax',
        secure: environment === 'production',
        path: '/api/auth',
        expires,
      });
      expect(options).not.toHaveProperty('domain');
      expect(options.maxAge).toBeGreaterThan(599000);
      expect(options.maxAge).toBeLessThanOrEqual(600000);
    },
  );
});
