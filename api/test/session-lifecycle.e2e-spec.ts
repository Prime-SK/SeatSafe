import request from 'supertest';
import { createTestApp } from './create-test-app.js';
import { SessionCredentialService } from '../src/auth/session-credential.service.js';
import { RegistrationError } from '../src/auth/registration-error.js';

describe('Cookie session HTTP contract', () => {
  let fixture: Awaited<ReturnType<typeof createTestApp>>;
  beforeEach(async () => {
    fixture = await createTestApp();
  });
  afterEach(async () => {
    await fixture.app.close();
  });
  const post = (operation = 'refresh') =>
    request(fixture.app.getHttpServer())
      .post('/api/auth/' + operation)
      .set('Origin', 'http://localhost:3000');
  const raw = 'A'.repeat(43);
  it.each([
    '',
    'seatsafe_refresh=x',
    `seatsafe_refresh="${raw}"`,
    `seatsafe_refresh=${raw}; seatsafe_refresh=${raw}`,
    `other=${raw}`,
  ])('rejects malformed refresh cookie without lookup: %s', async (cookie) => {
    const req = post();
    if (cookie) req.set('Cookie', cookie);
    const result = await req
      .send({ refreshToken: raw, userId: 'forged' })
      .expect(401);
    expect(result.body).toEqual({
      statusCode: 401,
      code: 'UNAUTHORIZED',
      message: 'Authentication required',
    });
    expect(result.headers['cache-control']).toBe('no-store');
    expect(result.headers['www-authenticate']).toBeUndefined();
    expect(result.headers['set-cookie'][0]).toContain(
      'Expires=Thu, 01 Jan 1970',
    );
    expect(fixture.credentialQuery.getOne).not.toHaveBeenCalled();
  });
  it('rejects unknown credentials without transaction or revocation', async () => {
    await post()
      .set('Cookie', 'seatsafe_refresh=' + raw)
      .expect(401);
    expect(fixture.credentialQuery.getOne).toHaveBeenCalledOnce();
    expect(fixture.database.transaction).not.toHaveBeenCalled();
  });
  it('ignores Bearer, query and body identity without a refresh cookie', async () => {
    await request(fixture.app.getHttpServer())
      .post('/api/auth/refresh?refreshToken=' + raw)
      .set('Origin', 'http://localhost:3000')
      .set('Authorization', 'Bearer ' + raw)
      .send({ token: raw })
      .expect(401);
    expect(fixture.credentialQuery.getOne).not.toHaveBeenCalled();
  });
  it.each(['refresh', 'logout'])(
    'rejects disallowed or missing origins for %s without clearing cookies',
    async (operation) => {
      for (const origin of [undefined, 'null', 'https://evil.example']) {
        const req = request(fixture.app.getHttpServer())
          .post('/api/auth/' + operation)
          .set('Cookie', 'seatsafe_refresh=' + raw);
        if (origin) req.set('Origin', origin);
        const result = await req.expect(403);
        expect(result.body.code).toBe('ORIGIN_NOT_ALLOWED');
        expect(result.headers['set-cookie']).toBeUndefined();
        expect(result.headers['cache-control']).toBe('no-store');
      }
      expect(fixture.credentialQuery.getOne).not.toHaveBeenCalled();
    },
  );
  it.each(['refresh', 'logout'])(
    'preserves safe database outages and the cookie on %s',
    async (operation) => {
      fixture.credentialQuery.getOne.mockRejectedValue(
        new Error('private SQL/password'),
      );
      const result = await post(operation)
        .set('Cookie', 'seatsafe_refresh=' + raw)
        .expect(503);
      expect(result.body).toEqual({
        statusCode: 503,
        code: 'DATABASE_UNAVAILABLE',
        message: 'Database unavailable',
      });
      expect(result.headers['set-cookie']).toBeUndefined();
      expect(result.headers['cache-control']).toBe('no-store');
    },
  );
  it('returns exactly the public refresh fields and sets a replacement only after service completion', async () => {
    const service = fixture.app.get(SessionCredentialService);
    vi.spyOn(service, 'refresh').mockResolvedValue({
      refreshToken: 'B'.repeat(43),
      sessionExpiresAt: new Date(Date.now() + 600000),
      profile: {
        accessToken: 'public-fixture',
        tokenType: 'Bearer',
        expiresIn: 900,
        user: {
          id: 'fixture',
          displayName: 'Learner',
          email: 'learner@example.test',
          role: 'USER',
        },
      },
    });
    const result = await post()
      .set('Cookie', 'seatsafe_refresh=' + raw)
      .expect(200);
    expect(Object.keys(result.body).sort()).toEqual([
      'accessToken',
      'expiresIn',
      'tokenType',
      'user',
    ]);
    expect(result.body).not.toHaveProperty('refreshToken');
    expect(result.headers['set-cookie'][0]).toContain(
      'seatsafe_refresh=' + 'B'.repeat(43),
    );
    expect(result.headers['cache-control']).toBe('no-store');
  });
  it('leaves cookies intact on safe refresh internal failures', async () => {
    vi.spyOn(
      fixture.app.get(SessionCredentialService),
      'refresh',
    ).mockRejectedValue(
      new RegistrationError(500, 'INTERNAL_ERROR', 'Unable to refresh session'),
    );
    const result = await post()
      .set('Cookie', 'seatsafe_refresh=' + raw)
      .expect(500);
    expect(result.headers['set-cookie']).toBeUndefined();
    expect(result.body.message).toBe('Unable to refresh session');
  });
  it.each([
    '',
    'seatsafe_refresh=x',
    `seatsafe_refresh=${raw}; seatsafe_refresh=${raw}`,
    `seatsafe_refresh=${raw}`,
  ])('supports idempotent empty/invalid/unknown logout: %s', async (cookie) => {
    for (let i = 0; i < 2; i++) {
      const req = post('logout');
      if (cookie) req.set('Cookie', cookie);
      const result = await req.expect(204);
      expect(result.text).toBe('');
      expect(result.headers['set-cookie'][0]).toContain(
        'Expires=Thu, 01 Jan 1970',
      );
      expect(result.headers['cache-control']).toBe('no-store');
    }
    expect(fixture.database.transaction).not.toHaveBeenCalled();
  });
  it('limits refresh/logout independently of each other and login/registration', async () => {
    for (let i = 0; i < 5; i++) await post().expect(401);
    const denied = await post().expect(429);
    expect(denied.body).toEqual({
      statusCode: 429,
      code: 'RATE_LIMITED',
      message: 'Too many refresh attempts. Please try again later.',
    });
    expect(denied.headers['set-cookie']).toBeUndefined();
    for (let i = 0; i < 5; i++) await post('logout').expect(204);
    const logout = await post('logout').expect(429);
    expect(logout.body.message).toBe(
      'Too many logout attempts. Please try again later.',
    );
    expect(logout.headers['set-cookie']).toBeUndefined();
    await post('login').send({}).expect(400);
    await post('register').send({}).expect(400);
  });
  it('documents cookie authentication, optional logout and all response contracts', async () => {
    const doc = (
      await request(fixture.app.getHttpServer())
        .get('/swagger-json')
        .expect(200)
    ).body;
    expect(doc.components.securitySchemes['refresh-cookie']).toMatchObject({
      type: 'apiKey',
      in: 'cookie',
      name: 'seatsafe_refresh',
    });
    expect(doc.paths['/api/auth/refresh'].post.security).toEqual([
      { 'refresh-cookie': [] },
    ]);
    expect(doc.paths['/api/auth/logout'].post.security).toBeUndefined();
    expect(doc.paths['/api/auth/me'].get.security).toEqual([
      { 'access-token': [] },
    ]);
    expect(
      Object.keys(doc.paths['/api/auth/refresh'].post.responses).sort(),
    ).toEqual(['200', '401', '403', '429', '500', '503']);
    expect(
      Object.keys(doc.paths['/api/auth/logout'].post.responses).sort(),
    ).toEqual(['204', '403', '429', '503']);
  });
});
