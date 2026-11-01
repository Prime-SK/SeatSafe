import type { MockInstance } from 'vitest';
import request from 'supertest';
import { JwtService } from '@nestjs/jwt';
import { createTestApp } from './create-test-app.js';
import { BookingsService } from '../src/bookings/bookings.service.js';
import { RegistrationError } from '../src/auth/registration-error.js';
describe('Booking HTTP contracts with mocked persistence', () => {
  let fixture: Awaited<ReturnType<typeof createTestApp>>;
  let token: string;
  let service: BookingsService;
  let reserve: MockInstance<BookingsService['reserve']>;
  let list: MockInstance<BookingsService['list']>;
  const profile = {
    id: '580f2e1c-163b-4585-ad9e-62b842d17226',
    displayName: 'Learner',
    email: 'u@example.test',
    role: 'USER',
    isEnabled: true,
  };
  const response = {
    id: 'f425e920-6ab6-4d68-bd86-0b4bde115875',
    workshopId: 'legacy-workshop',
    status: 'ACTIVE',
    createdAt: '2030-01-01T00:00:00.000Z',
    cancelledAt: null,
  };
  beforeEach(async () => {
    fixture = await createTestApp();
    service = fixture.app.get(BookingsService);
    token = fixture.app
      .get(JwtService)
      .sign(
        { sub: profile.id, sid: 'f425e920-6ab6-4d68-bd86-0b4bde115875' },
        { algorithm: 'HS256', expiresIn: 900 },
      );
    fixture.sessionQuery.getOne.mockResolvedValue({
      id: 'f425e920-6ab6-4d68-bd86-0b4bde115875',
      user: profile,
      userId: profile.id,
      expiresAt: new Date(Date.now() + 60000),
      revokedAt: null,
    });
    reserve = vi
      .spyOn(service, 'reserve')
      .mockResolvedValue(
        response as Awaited<ReturnType<BookingsService['reserve']>>,
      );
    list = vi.spyOn(service, 'list').mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      limit: 25,
    });
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await fixture.app.close();
  });
  it('derives owner from authenticated context and keeps no-store without cookies', async () => {
    const result = await request(fixture.app.getHttpServer())
      .post('/api/workshops/legacy-workshop/bookings')
      .set('Authorization', `Bearer ${token}`)
      .send({})
      .expect(201);
    expect(reserve).toHaveBeenCalledWith(
      expect.objectContaining({
        id: profile.id,
        sessionId: expect.any(String),
      }),
      'legacy-workshop',
    );
    expect(result.body).toEqual(response);
    expect(result.headers['cache-control']).toBe('no-store');
    expect(result.headers['set-cookie']).toBeUndefined();
  });
  it('rejects unauthenticated reservation and list access before feature logic', async () => {
    for (const path of [
      '/api/workshops/legacy-workshop/bookings',
      '/api/admin/workshops/legacy-workshop/bookings',
    ]) {
      const call = path.includes('/admin/')
        ? request(fixture.app.getHttpServer()).get(path)
        : request(fixture.app.getHttpServer()).post(path);
      const result = await call.expect(401);
      expect(result.headers['www-authenticate']).toBe('Bearer');
      expect(result.headers['cache-control']).toBe('no-store');
    }
    expect(reserve).not.toHaveBeenCalled();
    expect(list).not.toHaveBeenCalled();
  });
  it('authenticates before denying USER list access', async () => {
    const result = await request(fixture.app.getHttpServer())
      .get('/api/admin/workshops/legacy-workshop/bookings')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
    expect(result.body).toEqual({
      statusCode: 403,
      code: 'FORBIDDEN',
      message: 'Insufficient permissions',
    });
    expect(result.headers['www-authenticate']).toBeUndefined();
    expect(list).not.toHaveBeenCalled();
  });
  it.each([401, 503, 500])(
    'preserves safe handled failure %s and headers',
    async (status) => {
      reserve.mockRejectedValue(
        new RegistrationError(
          status,
          status === 401
            ? 'UNAUTHORIZED'
            : status === 503
              ? 'DATABASE_UNAVAILABLE'
              : 'INTERNAL_ERROR',
          status === 401
            ? 'Authentication required'
            : status === 503
              ? 'Database unavailable'
              : 'Unable to reserve seat',
        ),
      );
      const result = await request(fixture.app.getHttpServer())
        .post('/api/workshops/legacy-workshop/bookings')
        .set('Authorization', `Bearer ${token}`)
        .expect(status);
      expect(result.headers['cache-control']).toBe('no-store');
      expect(result.headers['www-authenticate']).toBe(
        status === 401 ? 'Bearer' : undefined,
      );
    },
  );
  it('documents both routes, pagination, booking fields and all relevant errors', async () => {
    const document = (
      await request(fixture.app.getHttpServer())
        .get('/swagger-json')
        .expect(200)
    ).body;
    const post = document.paths['/api/workshops/{id}/bookings'].post;
    expect(post.security).toEqual([{ 'access-token': [] }]);
    for (const status of ['201', '400', '401', '404', '409', '500', '503'])
      expect(post.responses[status]).toBeDefined();
    const list = document.paths['/api/admin/workshops/{id}/bookings'].get;
    for (const status of ['200', '400', '401', '403', '404', '500', '503'])
      expect(list.responses[status]).toBeDefined();
    expect(
      Object.keys(
        document.components.schemas.BookingResponseDto.properties,
      ).sort(),
    ).toEqual(Object.keys(response).sort());
    expect(
      list.parameters.map((value: { name: string }) => value.name),
    ).toEqual(expect.arrayContaining(['id', 'page', 'limit']));
  });
  it('rejects a non-JSON payload rather than treating it as an absent body', async () => {
    const result = await request(fixture.app.getHttpServer())
      .post('/api/workshops/legacy-workshop/bookings')
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'text/plain')
      .send('4')
      .expect(400);
    expect(result.body.code).toBe('VALIDATION_FAILED');
    expect(result.headers['cache-control']).toBe('no-store');
    expect(reserve).not.toHaveBeenCalled();
  });
  it.each([500, 503])(
    'returns a safe administrator-list failure %s',
    async (status) => {
      fixture.sessionQuery.getOne.mockResolvedValue({
        id: 'f425e920-6ab6-4d68-bd86-0b4bde115875',
        user: { ...profile, role: 'ADMIN' },
        expiresAt: new Date(Date.now() + 60000),
        revokedAt: null,
      });
      list.mockRejectedValue(
        new RegistrationError(
          status,
          status === 503 ? 'DATABASE_UNAVAILABLE' : 'INTERNAL_ERROR',
          status === 503 ? 'Database unavailable' : 'Unable to load bookings',
        ),
      );
      const result = await request(fixture.app.getHttpServer())
        .get('/api/admin/workshops/legacy-workshop/bookings')
        .set('Authorization', `Bearer ${token}`)
        .expect(status);
      expect(result.headers['cache-control']).toBe('no-store');
      expect(result.headers['www-authenticate']).toBeUndefined();
    },
  );
});
