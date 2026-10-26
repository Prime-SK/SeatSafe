import request from 'supertest';
import { request as rawRequest } from 'node:http';
import type { Server } from 'node:http';
import { createHash } from 'node:crypto';
import { RefreshTokenService } from '../src/auth/refresh-token.service.js';
import { createTestApp } from './create-test-app.js';

describe('Refresh issuance HTTP', () => {
  let fixture: Awaited<ReturnType<typeof createTestApp>>;
  const payload = {
    email: 'learner@example.test',
    password: 'unchanged password',
  };
  const user = {
    id: '580f2e1c-163b-4585-ad9e-62b842d17226',
    displayName: 'Learner',
    email: payload.email,
    role: 'USER',
    isEnabled: true,
    passwordHash: 'fixture',
  };
  beforeEach(async () => {
    fixture = await createTestApp();
    fixture.loginQuery.getOne.mockResolvedValue(user);
    fixture.lockedQuery.getOne.mockResolvedValue(user);
    fixture.passwordHasher.verify.mockResolvedValue(true);
  });
  afterEach(async () => {
    await fixture.app.close();
  });
  const login = () =>
    request(fixture.app.getHttpServer()).post('/api/auth/login');
  it.each([
    undefined,
    'null',
    'https://evil.example',
    'http://localhost:3000/',
    'http://localhost:3000/path',
    'http://localhost:3000, https://evil.example',
  ])(
    'rejects missing or unsafe Origin %s before credentials/transaction',
    async (origin) => {
      const req = login();
      if (origin !== undefined) req.set('Origin', origin);
      const response = await req.send(payload).expect(403);
      expect(response.body).toEqual({
        statusCode: 403,
        code: 'ORIGIN_NOT_ALLOWED',
        message: 'Request origin not allowed',
      });
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.headers['set-cookie']).toBeUndefined();
      expect(fixture.passwordHasher.verify).not.toHaveBeenCalled();
      expect(fixture.database.transaction).not.toHaveBeenCalled();
    },
  );
  it('accepts Referer fallback but never overrides a disallowed Origin', async () => {
    await login()
      .set('Referer', 'http://localhost:3000/swagger')
      .send(payload)
      .expect(200);
    await login()
      .set('Origin', 'null')
      .set('Referer', 'http://localhost:3000/swagger')
      .send(payload)
      .expect(403);
    await login()
      .set('Referer', 'https://evil.example/path')
      .send(payload)
      .expect(403);
  });
  it('issues only hash storage, fixed cookie expiry and unchanged JSON for distinct logins', async () => {
    const first = await login()
      .set('Origin', 'http://localhost:4200')
      .send(payload)
      .expect(200);
    const second = await login()
      .set('Origin', 'http://localhost:3000')
      .send(payload)
      .expect(200);
    const cookies = [first, second].map(
      (result) => result.headers['set-cookie'][0],
    );
    expect(cookies[0]).not.toBe(cookies[1]);
    for (let i = 0; i < 2; i++) {
      const cookie = cookies[i];
      const raw = cookie.match(/^seatsafe_refresh=([^;]+)/)![1];
      expect(cookie).toContain('HttpOnly');
      expect(cookie).toContain('SameSite=Lax');
      expect(cookie).toContain('Path=/api/auth');
      expect(cookie).not.toContain('Domain=');
      expect(cookie).not.toContain('Secure');
      const stored = fixture.refreshRepository.insert.mock.calls[i][0];
      expect(stored.tokenHash).toBe(
        createHash('sha256').update(raw).digest('hex'),
      );
      expect(JSON.stringify(stored)).not.toContain(raw);
      expect(JSON.stringify([first, second][i].body)).not.toContain(raw);
      expect(Object.keys([first, second][i].body).sort()).toEqual([
        'accessToken',
        'expiresIn',
        'tokenType',
        'user',
      ]);
      const session = fixture.sessionRepository.insert.mock.calls[i][0];
      expect(stored.sessionId).toBe(session.id);
      expect(new Date(cookie.match(/Expires=([^;]+)/)![1]).getTime()).toBe(
        Math.floor(session.expiresAt.getTime() / 1000) * 1000,
      );
    }
  });
  it.each(['generation', 'insert', 'commit', 'credentials'])(
    'does not change an existing browser cookie on %s failure',
    async (kind) => {
      if (kind === 'generation')
        vi.spyOn(
          fixture.app.get(RefreshTokenService),
          'generate',
        ).mockImplementation(() => {
          throw new Error('private generation error');
        });
      if (kind === 'insert')
        fixture.refreshRepository.insert.mockRejectedValue(
          new Error('private database error'),
        );
      if (kind === 'commit')
        fixture.database.transaction.mockRejectedValue(
          new Error('private commit error'),
        );
      if (kind === 'credentials')
        fixture.passwordHasher.verify.mockResolvedValue(false);
      const response = await login()
        .set('Origin', 'http://localhost:3000')
        .set('Cookie', 'seatsafe_refresh=existing')
        .send(payload)
        .expect(
          kind === 'generation' ? 500 : kind === 'credentials' ? 401 : 503,
        );
      expect(response.headers['set-cookie']).toBeUndefined();
      expect(JSON.stringify(response.body)).not.toContain('private');
      expect(response.headers['cache-control']).toBe('no-store');
    },
  );
  it.each(['Origin', 'Referer'])(
    'rejects duplicate %s raw headers',
    async (header) => {
      await fixture.app.listen(0, '127.0.0.1');
      const address = (
        fixture.app.getHttpServer() as unknown as Server
      ).address();
      if (!address || typeof address === 'string')
        throw new Error('Expected TCP address');
      const result = await new Promise<{ status: number; body: string }>(
        (resolve, reject) => {
          const req = rawRequest(
            {
              hostname: '127.0.0.1',
              port: address.port,
              path: '/api/auth/login',
              method: 'POST',
              headers: [
                'Host',
                `127.0.0.1:${address.port}`,
                header,
                'http://localhost:3000',
                header,
                'http://localhost:3000',
                'Content-Type',
                'application/json',
                'Connection',
                'close',
              ],
            },
            (res) => {
              let body = '';
              res.on('data', (chunk) => (body += String(chunk)));
              res.on('end', () => resolve({ status: res.statusCode!, body }));
            },
          );
          req.on('error', reject);
          req.end(JSON.stringify(payload));
        },
      );
      expect(result.status).toBe(403);
      expect(JSON.parse(result.body).code).toBe('ORIGIN_NOT_ALLOWED');
    },
  );
  it('requires cookie authentication for refresh, supports empty logout, and retains Bearer-only me', async () => {
    await request(fixture.app.getHttpServer())
      .post('/api/auth/refresh')
      .set('Origin', 'http://localhost:3000')
      .expect(401);
    await request(fixture.app.getHttpServer())
      .post('/api/auth/logout')
      .set('Origin', 'http://localhost:3000')
      .expect(204);
    await request(fixture.app.getHttpServer())
      .get('/api/auth/me')
      .set('Cookie', 'seatsafe_refresh=fixture')
      .expect(401);
  });
});
