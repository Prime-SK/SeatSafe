import request from 'supertest';
import { JwtService } from '@nestjs/jwt';
import { createTestApp } from './create-test-app.js';

describe('Administrator access HTTP contract', () => {
  let fixture: Awaited<ReturnType<typeof createTestApp>>;
  const userId = '580f2e1c-163b-4585-ad9e-62b842d17226';
  const sessionId = 'f425e920-6ab6-4d68-bd86-0b4bde115875';
  let token: string;
  beforeEach(async () => {
    fixture = await createTestApp();
    token = fixture.app
      .get(JwtService)
      .sign(
        { sub: userId, sid: sessionId },
        { algorithm: 'HS256', expiresIn: 900 },
      );
    fixture.sessionQuery.getOne.mockResolvedValue({
      id: sessionId,
      userId,
      expiresAt: new Date(Date.now() + 604800000),
      revokedAt: null,
      user: {
        id: userId,
        displayName: 'Administrator',
        email: 'admin@example.test',
        role: 'ADMIN',
        isEnabled: true,
      },
    });
  });
  afterEach(async () => {
    await fixture.app.close();
  });
  const access = () =>
    request(fixture.app.getHttpServer())
      .get('/api/admin/access')
      .set('Authorization', 'Bearer ' + token);
  it('returns only authorized and performs one session read without writes', async () => {
    const result = await access().expect(200);
    expect(result.body).toEqual({ authorized: true });
    expect(result.headers['cache-control']).toBe('no-store');
    expect(result.headers['set-cookie']).toBeUndefined();
    expect(fixture.sessionQuery.getOne).toHaveBeenCalledTimes(1);
    expect(fixture.database.transaction).not.toHaveBeenCalled();
  });
  it('rejects an authenticated user with a safe 403 and no challenge', async () => {
    const row = await fixture.sessionQuery.getOne();
    row.user.role = 'USER';
    const result = await access().expect(403);
    expect(result.body).toEqual({
      statusCode: 403,
      code: 'FORBIDDEN',
      message: 'Insufficient permissions',
    });
    expect(result.headers['cache-control']).toBe('no-store');
    expect(result.headers['www-authenticate']).toBeUndefined();
  });
  it('authenticates before checking permission', async () => {
    const result = await request(fixture.app.getHttpServer())
      .get('/api/admin/access')
      .expect(401);
    expect(result.body).toEqual({
      statusCode: 401,
      code: 'UNAUTHORIZED',
      message: 'Authentication required',
    });
    expect(result.headers['cache-control']).toBe('no-store');
    expect(result.headers['www-authenticate']).toBe('Bearer');
    expect(fixture.sessionQuery.getOne).not.toHaveBeenCalled();
  });
  it('does not trust role claims, headers or query parameters', async () => {
    const row = await fixture.sessionQuery.getOne();
    row.user.role = 'USER';
    token = fixture.app
      .get(JwtService)
      .sign(
        { sub: userId, sid: sessionId, role: 'ADMIN' },
        { algorithm: 'HS256', expiresIn: 900 },
      );
    await access().query({ role: 'ADMIN' }).set('X-Role', 'ADMIN').expect(403);
  });
  it('keeps outages distinct from authorization failures', async () => {
    fixture.sessionQuery.getOne.mockRejectedValue(
      new Error('private database error'),
    );
    const result = await access().expect(503);
    expect(result.body).toEqual({
      statusCode: 503,
      code: 'DATABASE_UNAVAILABLE',
      message: 'Database unavailable',
    });
    expect(result.headers['cache-control']).toBe('no-store');
    expect(result.headers['www-authenticate']).toBeUndefined();
  });
  it('leaves public browsing available without authentication', async () => {
    await request(fixture.app.getHttpServer())
      .get('/api/workshops')
      .expect(200);
  });
  it('documents bearer security, exact success and errors with no-store', async () => {
    const result = await request(fixture.app.getHttpServer())
      .get('/swagger-json')
      .expect(200);
    const operation = result.body.paths['/api/admin/access'].get;
    expect(operation.security).toEqual([{ 'access-token': [] }]);
    for (const code of ['200', '401', '403', '503'])
      expect(operation.responses[code].headers['Cache-Control']).toBeDefined();
    expect(
      operation.responses['401'].headers['WWW-Authenticate'],
    ).toBeDefined();
    expect(
      operation.responses['403'].headers['WWW-Authenticate'],
    ).toBeUndefined();
    expect(result.body.components.schemas.AdminAccessDto.required).toEqual([
      'authorized',
    ]);
  });
});
