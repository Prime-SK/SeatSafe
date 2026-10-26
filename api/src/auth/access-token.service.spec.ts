import { JwtService } from '@nestjs/jwt';
import {
  AccessTokenService,
  validateJwtSecret,
} from './access-token.service.js';

describe('Access tokens and configuration', () => {
  const secret = 'public-unit-test-signing-secret-32-bytes';
  it.each([undefined, '', ' '.repeat(40), 'too-short', 123])(
    'rejects invalid configuration without revealing it: %s',
    (value) => {
      expect(() => validateJwtSecret(value)).toThrow(
        'JWT_SECRET must be a nonblank string of at least 32 bytes',
      );
    },
  );
  it('preserves the secret exactly and measures UTF-8 bytes', () => {
    expect(validateJwtSecret(' ' + secret + ' ')).toBe(' ' + secret + ' ');
    expect(validateJwtSecret('🔐'.repeat(8))).toBe('🔐'.repeat(8));
  });
  it('signs only identifiers and timestamps with the required lifetime and algorithm', async () => {
    const jwt = new JwtService({ secret });
    const token = await new AccessTokenService(jwt).sign(
      'user-id',
      'session-id',
    );
    const payload = jwt.verify<Record<string, unknown>>(token, {
      algorithms: ['HS256'],
    });
    expect(Object.keys(payload).sort()).toEqual(['exp', 'iat', 'sid', 'sub']);
    expect(payload.sub).toBe('user-id');
    expect(payload.sid).toBe('session-id');
    expect(Number(payload.exp) - Number(payload.iat)).toBe(900);
    expect(() => jwt.verify(token, { secret: 'wrong-secret' })).toThrow();
    expect(() =>
      jwt.verify(token, { clockTimestamp: Number(payload.exp) }),
    ).toThrow();
    expect(() =>
      jwt.verify(token.slice(0, -1) + '!', { algorithms: ['HS256'] }),
    ).toThrow();
  });
  it('verifies the required UUID claims of an actual issued token', async () => {
    const service = new AccessTokenService(new JwtService({ secret }));
    const userId = '580f2e1c-163b-4585-ad9e-62b842d17226';
    const sessionId = 'f425e920-6ab6-4d68-bd86-0b4bde115875';
    const claims = await service.verify(await service.sign(userId, sessionId));
    expect(claims).toMatchObject({ sub: userId, sid: sessionId });
    expect(claims.exp - claims.iat).toBe(900);
  });
});
