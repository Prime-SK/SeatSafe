import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types.js';
import request from 'supertest';
import { QueryFailedError } from 'typeorm';
import { createTestApp } from './create-test-app.js';

describe('Registration HTTP', () => {
  let app: INestApplication<App>;
  let userRepository: Awaited<
    ReturnType<typeof createTestApp>
  >['userRepository'];
  let passwordHasher: Awaited<
    ReturnType<typeof createTestApp>
  >['passwordHasher'];
  const valid = {
    displayName: '  Sample learner  ',
    email: '  LEARNER@example.test  ',
    password: '  unchanged password  ',
  };
  beforeEach(async () => {
    ({ app, userRepository, passwordHasher } = await createTestApp());
  });
  afterEach(async () => {
    await app.close();
  });
  it('normalizes input and returns 201 without credentials or sessions', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send(valid)
      .expect(201);
    expect(response.body).toEqual({
      id: expect.any(String),
      displayName: 'Sample learner',
      email: 'learner@example.test',
      role: 'USER',
    });
    expect(response.headers['set-cookie']).toBeUndefined();
    expect(passwordHasher.hash).toHaveBeenCalledWith(valid.password);
    expect(userRepository.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        role: 'USER',
        isEnabled: true,
        passwordHash: 'test-only-hash',
      }),
    );
    expect(response.text).not.toContain(valid.password);
  });
  it.each([
    { ...valid, displayName: '  ' },
    { ...valid, displayName: 123 },
    { ...valid, displayName: 'a'.repeat(101) },
    { ...valid, email: 'bad-address' },
    { ...valid, email: true },
    { ...valid, email: 'a'.repeat(255) + '@example.test' },
    { ...valid, password: 'short' },
    { ...valid, password: 'a'.repeat(129) },
    { ...valid, password: ' '.repeat(15) },
    { ...valid, password: 123 },
    { ...valid, role: 'ADMIN' },
    { ...valid, isEnabled: false },
    { ...valid, confirmation: valid.password },
    {},
  ])('rejects malformed or privileged input safely: %#', async (body) => {
    const response = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send(body)
      .expect(400);
    expect(response.body).toMatchObject({
      statusCode: 400,
      code: 'VALIDATION_FAILED',
      message: 'Invalid registration data',
      fieldErrors: expect.any(Object),
    });
    expect(response.text).not.toContain('unchanged password');
    expect(passwordHasher.hash).not.toHaveBeenCalled();
    expect(userRepository.insert).not.toHaveBeenCalled();
  });
  it('counts Unicode characters consistently and preserves the password', async () => {
    const password = '🔐'.repeat(15);
    await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ ...valid, password })
      .expect(201);
    expect(passwordHasher.hash).toHaveBeenCalledWith(password);
  });
  it('rejects 14 astral Unicode characters', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ ...valid, password: '🔐'.repeat(14) })
      .expect(400);
  });
  it('maps duplicate email to safe 409', async () => {
    userRepository.insert.mockRejectedValue(
      new QueryFailedError(
        'private SQL',
        [],
        Object.assign(new Error('driver secret'), {
          code: '23505',
          constraint: 'UQ_users_email',
        }),
      ),
    );
    await request(app.getHttpServer())
      .post('/api/auth/register')
      .send(valid)
      .expect(409)
      .expect({
        statusCode: 409,
        code: 'EMAIL_ALREADY_EXISTS',
        message: 'An account with this email already exists',
      });
  });
  it('maps database and hashing failures without raw messages', async () => {
    userRepository.insert.mockRejectedValueOnce(new Error('private DB detail'));
    await request(app.getHttpServer())
      .post('/api/auth/register')
      .send(valid)
      .expect(503)
      .expect({
        statusCode: 503,
        code: 'DATABASE_UNAVAILABLE',
        message: 'Database unavailable',
      });
    passwordHasher.hash.mockRejectedValueOnce(
      new Error('private native detail'),
    );
    await request(app.getHttpServer())
      .post('/api/auth/register')
      .send(valid)
      .expect(500)
      .expect({
        statusCode: 500,
        code: 'INTERNAL_ERROR',
        message: 'Unable to create account',
      });
  });
  it('limits only registration, before hashing the sixth request', async () => {
    for (let index = 0; index < 5; index++)
      await request(app.getHttpServer())
        .post('/api/auth/register')
        .send(valid)
        .expect(201);
    await request(app.getHttpServer())
      .post('/api/auth/register')
      .send(valid)
      .expect(429)
      .expect({
        statusCode: 429,
        code: 'RATE_LIMITED',
        message: 'Too many registration attempts. Please try again later.',
      });
    expect(passwordHasher.hash).toHaveBeenCalledTimes(5);
    await request(app.getHttpServer()).get('/api/workshops').expect(200);
  });
  it('documents request/response contracts and every registration failure', async () => {
    const { body } = await request(app.getHttpServer())
      .get('/swagger-json')
      .expect(200);
    const endpoint = body.paths['/api/auth/register'].post;
    expect(endpoint.tags).toEqual(['Auth']);
    expect(Object.keys(endpoint.responses).sort()).toEqual([
      '201',
      '400',
      '409',
      '429',
      '500',
      '503',
    ]);
    expect(
      body.components.schemas.RegisterDto.properties.password,
    ).toMatchObject({ minLength: 15, maxLength: 128, writeOnly: true });
    expect(
      Object.keys(body.components.schemas.RegisteredUserDto.properties),
    ).toEqual(['id', 'displayName', 'email', 'role']);
  });
});
