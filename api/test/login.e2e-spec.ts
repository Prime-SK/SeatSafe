import request from 'supertest';
import { JwtService } from '@nestjs/jwt';
import { AccessTokenService } from '../src/auth/access-token.service.js';
import { PasswordHasher } from '../src/auth/password-hasher.js';
import { createTestApp } from './create-test-app.js';

describe('Login HTTP contract', () => {
  let fixture: Awaited<ReturnType<typeof createTestApp>>;
  const user = {
    id: '580f2e1c-163b-4585-ad9e-62b842d17226',
    displayName: 'Learner',
    email: 'learner@example.test',
    passwordHash: 'private-test-hash',
    role: 'ADMIN',
    isEnabled: true,
  };
  const payload = {
    email: ' Learner@Example.test ',
    password: ' 🔐 unchanged password ',
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
  const post = (body: object) =>
    request(fixture.app.getHttpServer())
      .post('/api/auth/login')
      .set('Origin', 'http://localhost:3000')
      .send(body);
  it('normalizes email, preserves password, signs a token and returns only safe fields', async () => {
    const result = await post(payload).expect(200);
    expect(result.headers['cache-control']).toBe('no-store');
    expect(result.headers['set-cookie'][0]).toContain('seatsafe_refresh=');
    expect(Object.keys(result.body).sort()).toEqual([
      'accessToken',
      'expiresIn',
      'tokenType',
      'user',
    ]);
    expect(result.body.user).toEqual({
      id: user.id,
      displayName: user.displayName,
      email: user.email,
      role: 'ADMIN',
    });
    expect(result.body).toMatchObject({ tokenType: 'Bearer', expiresIn: 900 });
    expect(fixture.loginQuery.where).toHaveBeenCalledWith(
      'user.email = :email',
      { email: 'learner@example.test' },
    );
    expect(fixture.loginQuery.addSelect).toHaveBeenCalledWith(
      'user.passwordHash',
    );
    expect(fixture.passwordHasher.verify).toHaveBeenCalledWith(
      user.passwordHash,
      payload.password,
    );
    expect(fixture.lockedQuery.setLock).toHaveBeenCalledWith(
      'pessimistic_write',
    );
    const claims = fixture.app.get(JwtService).verify(result.body.accessToken);
    const session = fixture.sessionRepository.insert.mock.calls[0][0];
    expect(claims.sub).toBe(user.id);
    expect(claims.sid).toBe(session.id);
    expect(session.expiresAt.getTime() - session.createdAt.getTime()).toBe(
      7 * 24 * 60 * 60 * 1000,
    );
    expect(session.revokedAt).toBeNull();
  });
  it.each([
    { ...payload, password: '' },
    { ...payload, password: 123 },
    { ...payload, password: '🔐'.repeat(129) },
    { ...payload, email: 'bad' },
    { ...payload, email: 123 },
    { ...payload, role: 'ADMIN' },
    { ...payload, id: user.id },
    { ...payload, sid: 'forged' },
    { email: payload.email },
  ])('rejects invalid/unknown fields before verification: %j', async (body) => {
    const result = await post(body).expect(400);
    expect(result.body).toMatchObject({
      code: 'VALIDATION_FAILED',
      message: 'Invalid login data',
    });
    expect(result.body.fieldErrors).toBeDefined();
    expect(fixture.passwordHasher.verify).not.toHaveBeenCalled();
    expect(fixture.sessionRepository.insert).not.toHaveBeenCalled();
  });
  it('accepts short wrong passwords and 128 Unicode characters for verification', async () => {
    fixture.passwordHasher.verify.mockResolvedValue(false);
    await post({ ...payload, password: 'x' }).expect(401);
    await post({ ...payload, password: '🔐'.repeat(128) }).expect(401);
    expect(fixture.passwordHasher.verify).toHaveBeenCalledTimes(2);
  });
  it.each(['unknown', 'incorrect', 'disabled'])(
    'uses the same credential response for %s',
    async (kind) => {
      if (kind === 'unknown') fixture.loginQuery.getOne.mockResolvedValue(null);
      if (kind === 'incorrect')
        fixture.passwordHasher.verify.mockResolvedValue(false);
      if (kind === 'disabled')
        fixture.loginQuery.getOne.mockResolvedValue({
          ...user,
          isEnabled: false,
        });
      const result = await post(payload).expect(401);
      expect(result.body).toEqual({
        statusCode: 401,
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid email or password',
      });
      expect(fixture.database.transaction).not.toHaveBeenCalled();
      if (kind === 'unknown')
        expect(fixture.passwordHasher.verify).toHaveBeenCalledWith(
          PasswordHasher.dummyHash,
          payload.password,
        );
    },
  );
  it.each([null, { ...user, isEnabled: false }])(
    'rechecks the user while locked',
    async (current) => {
      fixture.lockedQuery.getOne.mockResolvedValue(current);
      await post(payload).expect(401);
      expect(fixture.sessionRepository.insert).not.toHaveBeenCalled();
    },
  );
  it.each(['read', 'insert', 'commit'])(
    'hides database details from %s failures',
    async (kind) => {
      const error = new Error('private SQL and credentials');
      if (kind === 'read') fixture.loginQuery.getOne.mockRejectedValue(error);
      if (kind === 'insert')
        fixture.sessionRepository.insert.mockRejectedValue(error);
      if (kind === 'commit')
        fixture.database.transaction.mockRejectedValue(error);
      expect((await post(payload).expect(503)).body).toEqual({
        statusCode: 503,
        code: 'DATABASE_UNAVAILABLE',
        message: 'Database unavailable',
      });
    },
  );
  it.each(['verification', 'signing'])('hides %s failures', async (kind) => {
    if (kind === 'verification')
      fixture.passwordHasher.verify.mockRejectedValue(
        new Error('private hash'),
      );
    else
      fixture.app.get(AccessTokenService).sign = async () => {
        throw new Error('private key');
      };
    expect((await post(payload).expect(500)).body).toEqual({
      statusCode: 500,
      code: 'INTERNAL_ERROR',
      message: 'Unable to sign in',
    });
  });
  it('limits login separately from registration, including invalid attempts', async () => {
    for (let count = 0; count < 5; count++) await post({}).expect(400);
    expect((await post({}).expect(429)).body).toEqual({
      statusCode: 429,
      code: 'RATE_LIMITED',
      message: 'Too many login attempts. Please try again later.',
    });
    await request(fixture.app.getHttpServer())
      .post('/api/auth/register')
      .send({})
      .expect(400);
  });
  it('documents request, safe success, no-store header and all error statuses', async () => {
    const doc = (
      await request(fixture.app.getHttpServer())
        .get('/swagger-json')
        .expect(200)
    ).body;
    const operation = doc.paths['/api/auth/login'].post;
    expect(Object.keys(operation.responses).sort()).toEqual([
      '200',
      '400',
      '401',
      '403',
      '429',
      '500',
      '503',
    ]);
    expect(
      operation.responses['200'].headers['Cache-Control'].schema.example,
    ).toBe('no-store');
    expect(
      Object.keys(doc.components.schemas.LoginDto.properties).sort(),
    ).toEqual(['email', 'password']);
    expect(
      Object.keys(doc.components.schemas.LoginResultDto.properties).sort(),
    ).toEqual(['accessToken', 'expiresIn', 'tokenType', 'user']);
    expect(
      doc.components.schemas.AccountSummaryDto.properties.role.enum,
    ).toEqual(['USER', 'ADMIN']);
  });
});
