import request from 'supertest';
import { request as rawRequest } from 'node:http';
import { createHmac } from 'node:crypto';
import { createTestApp } from './create-test-app.js';

describe('Protected current-account HTTP contract', () => {
  let fixture: Awaited<ReturnType<typeof createTestApp>>;
  const userId = '580f2e1c-163b-4585-ad9e-62b842d17226';
  const sessionId = 'f425e920-6ab6-4d68-bd86-0b4bde115875';
  const summary = {
    id: userId,
    displayName: 'Current learner',
    email: 'learner@example.test',
    role: 'USER',
  };
  const secret = 'public-http-test-jwt-secret-32-bytes-minimum';
  function token(
    overrides: Record<string, unknown> = {},
    signingSecret = secret,
    algorithm = 'HS256',
  ) {
    const now = Math.floor(Date.now() / 1000);
    const encode = (value: unknown) =>
      Buffer.from(JSON.stringify(value)).toString('base64url');
    const input =
      encode({ alg: algorithm, typ: 'JWT' }) +
      '.' +
      encode({
        sub: userId,
        sid: sessionId,
        iat: now,
        exp: now + 900,
        ...overrides,
      });
    return (
      input +
      '.' +
      createHmac(algorithm === 'HS384' ? 'sha384' : 'sha256', signingSecret)
        .update(input)
        .digest('base64url')
    );
  }
  const get = (header?: string) => {
    const query = request(fixture.app.getHttpServer()).get('/api/auth/me');
    return header === undefined ? query : query.set('Authorization', header);
  };
  beforeEach(async () => {
    fixture = await createTestApp();
    fixture.sessionQuery.getOne.mockResolvedValue({
      id: sessionId,
      userId,
      expiresAt: new Date(Date.now() + 604800000),
      revokedAt: null,
      user: { ...summary, isEnabled: true, passwordHash: 'must-not-leak' },
    });
  });
  afterEach(async () => {
    await fixture.app.close();
  });
  function expectUnauthorized(result: {
    body: unknown;
    headers: Record<string, string>;
  }) {
    expect(result.body).toEqual({
      statusCode: 401,
      code: 'UNAUTHORIZED',
      message: 'Authentication required',
    });
    expect(result.headers['www-authenticate']).toBe('Bearer');
    expect(result.headers['cache-control']).toBe('no-store');
  }
  it('returns exactly the current safe profile after one joined lookup', async () => {
    const result = await get('bEaReR ' + token()).expect(200);
    expect(result.body).toEqual(summary);
    expect(result.headers['cache-control']).toBe('no-store');
    expect(result.headers['set-cookie']).toBeUndefined();
    expect(fixture.sessionQuery.innerJoinAndSelect).toHaveBeenCalledWith(
      'session.user',
      'user',
    );
    expect(fixture.sessionQuery.where).toHaveBeenCalledWith(
      'session.id = :sessionId',
      { sessionId },
    );
    expect(fixture.sessionQuery.andWhere).toHaveBeenCalledWith(
      'session.userId = :userId',
      { userId },
    );
    expect(fixture.sessionQuery.getOne).toHaveBeenCalledTimes(1);
    expect(fixture.sessionRepository.insert).not.toHaveBeenCalled();
    expect(fixture.database.transaction).not.toHaveBeenCalled();
  });
  it.each([
    undefined,
    '',
    'Basic abc',
    'Bearer',
    'Bearer ',
    'Bearer a.b.c, Bearer a.b.c',
    'Bearer  a.b.c',
    'Bearer a.b.c extra',
  ])(
    'rejects malformed or absent header %s before database access',
    async (header) => {
      expectUnauthorized(await get(header).expect(401));
      expect(fixture.sessionQuery.getOne).not.toHaveBeenCalled();
    },
  );
  it.each([
    ['wrong secret', () => token({}, 'wrong-secret')],
    [
      'tampered',
      () => {
        const parts = token().split('.');
        parts[2] = (parts[2][0] === 'A' ? 'B' : 'A') + parts[2].slice(1);
        return parts.join('.');
      },
    ],
    ['algorithm', () => token({}, secret, 'HS384')],
    ['expired', () => token({ iat: 1, exp: 2 })],
    ['missing subject', () => token({ sub: undefined })],
    ['invalid subject', () => token({ sub: 'bad' })],
    ['invalid session', () => token({ sid: 123 })],
    ['missing session', () => token({ sid: undefined })],
    ['missing expiry', () => token({ exp: undefined })],
    ['missing issue time', () => token({ iat: undefined })],
    ['fractional timestamp', () => token({ iat: 1.5 })],
    ['invalid expiry type', () => token({ exp: 'tomorrow' })],
    [
      'invalid timestamp order',
      () => token({ iat: 9999999999, exp: 9999999998 }),
    ],
  ] as const)(
    'rejects %s token before database access',
    async (_name, mint) => {
      expectUnauthorized(await get('Bearer ' + mint()).expect(401));
      expect(fixture.sessionQuery.getOne).not.toHaveBeenCalled();
    },
  );
  it('rejects duplicate Authorization headers even if Node hides one value', async () => {
    await fixture.app.listen(0, '127.0.0.1');
    const url = new URL('/api/auth/me', await fixture.app.getUrl());
    const result = await new Promise<{
      status: number | undefined;
      body: unknown;
      headers: Record<string, string>;
    }>((resolve, reject) => {
      const call = rawRequest(
        url,
        {
          headers: [
            'Host',
            url.host,
            'Connection',
            'close',
            'Authorization',
            'Bearer ' + token(),
            'Authorization',
            'Bearer ' + token(),
          ],
        },
        (response) => {
          let body = '';
          response.setEncoding('utf8');
          response.on('data', (part: string) => {
            body += part;
          });
          response.on('end', () => {
            try {
              resolve({
                status: response.statusCode,
                body: JSON.parse(body) as unknown,
                headers: response.headers as Record<string, string>,
              });
            } catch (error) {
              reject(error);
            }
          });
        },
      );
      call.on('error', reject);
      call.end();
    });
    expect(result.status).toBe(401);
    expectUnauthorized(result);
    expect(fixture.sessionQuery.getOne).not.toHaveBeenCalled();
  });
  it.each(['missing', 'missing user', 'revoked', 'expired', 'disabled'])(
    'rejects %s session/account uniformly',
    async (kind) => {
      const session = await fixture.sessionQuery.getOne();
      fixture.sessionQuery.getOne.mockClear();
      if (kind === 'missing')
        fixture.sessionQuery.getOne.mockResolvedValue(null);
      else
        fixture.sessionQuery.getOne.mockResolvedValue({
          ...session,
          ...(kind === 'revoked'
            ? { revokedAt: new Date() }
            : kind === 'expired'
              ? { expiresAt: new Date(0) }
              : kind === 'disabled'
                ? { user: { ...session.user, isEnabled: false } }
                : { user: null }),
        });
      expectUnauthorized(await get('Bearer ' + token()).expect(401));
    },
  );
  it('does not disguise a database outage as an invalid credential', async () => {
    fixture.sessionQuery.getOne.mockRejectedValue(
      new Error('private SQL and password'),
    );
    const result = await get('Bearer ' + token()).expect(503);
    expect(result.body).toEqual({
      statusCode: 503,
      code: 'DATABASE_UNAVAILABLE',
      message: 'Database unavailable',
    });
    expect(result.headers['cache-control']).toBe('no-store');
    expect(result.headers['www-authenticate']).toBeUndefined();
  });
  it('ignores submitted identity, cookie tokens and token role claims', async () => {
    expectUnauthorized(
      await request(fixture.app.getHttpServer())
        .get('/api/auth/me?accessToken=' + token())
        .set('Cookie', 'accessToken=' + token())
        .expect(401),
    );
    const result = await request(fixture.app.getHttpServer())
      .get('/api/auth/me?id=someone-else')
      .set('Authorization', 'Bearer ' + token({ role: 'ADMIN' }))
      .expect(200);
    expect(result.body).toEqual(summary);
  });
  it('keeps public routes public and documents the protected endpoints', async () => {
    await request(fixture.app.getHttpServer())
      .get('/api/workshops')
      .expect(200);
    await request(fixture.app.getHttpServer()).get('/api/health').expect(200);
    await request(fixture.app.getHttpServer())
      .post('/api/auth/login')
      .set('Origin', 'http://localhost:3000')
      .send({})
      .expect(400);
    await request(fixture.app.getHttpServer())
      .post('/api/auth/register')
      .send({})
      .expect(400);
    const doc = (
      await request(fixture.app.getHttpServer())
        .get('/swagger-json')
        .expect(200)
    ).body;
    expect(doc.components.securitySchemes['access-token']).toMatchObject({
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'JWT',
    });
    for (const [path, operations] of Object.entries(doc.paths)) {
      for (const operation of Object.values(
        operations as Record<string, { security?: unknown }>,
      )) {
        if (path === '/api/auth/me' || path.startsWith('/api/admin/'))
          expect(operation.security).toEqual([{ 'access-token': [] }]);
        else if (path === '/api/auth/refresh')
          expect(operation.security).toEqual([{ 'refresh-cookie': [] }]);
        else expect(operation.security).toBeUndefined();
      }
    }
    expect(Object.keys(doc.paths['/api/auth/me'].get.responses).sort()).toEqual(
      ['200', '401', '503'],
    );
    const html = await request(fixture.app.getHttpServer())
      .get('/swagger/swagger-ui-init.js')
      .expect(200);
    expect(html.text).toContain('"persistAuthorization": false');
  });
});
