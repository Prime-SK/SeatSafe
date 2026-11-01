import { JwtService } from '@nestjs/jwt';
import type { MockInstance } from 'vitest';
import request from 'supertest';
import { createTestApp } from './create-test-app.js';
import { BookingsService } from '../src/bookings/bookings.service.js';
import { RegistrationError } from '../src/auth/registration-error.js';

describe('Private booking history and cancellation HTTP contracts', () => {
  let fixture: Awaited<ReturnType<typeof createTestApp>>;
  let token: string;
  let cancel: MockInstance<BookingsService['cancel']>;
  let mine: MockInstance<BookingsService['mine']>;
  const ownerId = '580f2e1c-163b-4585-ad9e-62b842d17226';
  const id = 'f425e920-6ab6-4d68-bd86-0b4bde115875';
  const response = {
    id,
    workshopId: 'legacy-workshop',
    status: 'CANCELLED' as const,
    createdAt: '2030-01-01T00:00:00.000Z',
    cancelledAt: '2030-02-01T00:00:00.000Z',
  };
  beforeEach(async () => {
    fixture = await createTestApp();
    token = fixture.app
      .get(JwtService)
      .sign({ sub: ownerId, sid: id }, { algorithm: 'HS256', expiresIn: 900 });
    fixture.sessionQuery.getOne.mockResolvedValue({
      id,
      userId: ownerId,
      user: {
        id: ownerId,
        displayName: 'Owner',
        email: 'owner@example.test',
        role: 'USER',
        isEnabled: true,
      },
      expiresAt: new Date(Date.now() + 60000),
      revokedAt: null,
    });
    const service = fixture.app.get(BookingsService);
    cancel = vi.spyOn(service, 'cancel').mockResolvedValue(response);
    mine = vi
      .spyOn(service, 'mine')
      .mockResolvedValue({ items: [], total: 0, page: 1, limit: 25 });
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await fixture.app.close();
  });
  const cancelCall = () =>
    request(fixture.app.getHttpServer())
      .post(`/api/bookings/${id}/cancel`)
      .set('Authorization', `Bearer ${token}`);
  const mineCall = (suffix = '') =>
    request(fixture.app.getHttpServer())
      .get(`/api/bookings/me${suffix}`)
      .set('Authorization', `Bearer ${token}`);
  it('cancels with no request key, derives ownership from principal and maps the exact response', async () => {
    const result = await cancelCall().send({}).expect(200);
    expect(result.body).toEqual(response);
    expect(cancel).toHaveBeenCalledWith(
      expect.objectContaining({ id: ownerId, sessionId: id }),
      id,
    );
    expect(result.headers['cache-control']).toBe('no-store');
    expect(result.headers['set-cookie']).toBeUndefined();
    expect(result.headers['www-authenticate']).toBeUndefined();
    await cancelCall().expect(200);
  });
  it('uses defaults and passes only validated page/limit to private listing', async () => {
    const result = await mineCall().expect(200);
    expect(result.body).toEqual({ items: [], total: 0, page: 1, limit: 25 });
    expect(mine).toHaveBeenCalledWith(
      expect.objectContaining({ id: ownerId }),
      { page: 1, limit: 25 },
    );
    await mineCall('?page=2&limit=100').expect(200);
    expect(mine).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: ownerId }),
      { page: 2, limit: 100 },
    );
    expect(result.headers['cache-control']).toBe('no-store');
  });
  it.each([
    '?page=0',
    '?page=-1',
    '?page=2147483648',
    '?page=1.5',
    '?limit=0',
    '?limit=101',
    '?limit=word',
    '?limit=1&limit=2',
    '?userId=other',
    '?status=ACTIVE',
  ])('rejects malformed or unknown list query %s', async (suffix) => {
    const result = await mineCall(suffix).expect(400);
    expect(result.body).toMatchObject({
      code: 'VALIDATION_FAILED',
      message: 'Invalid booking query',
    });
    expect(mine).not.toHaveBeenCalled();
  });
  it.each([
    null,
    [],
    true,
    1,
    'text',
    { userId: ownerId },
    { quantity: 1 },
    { status: 'CANCELLED' },
  ])('rejects cancellation body %j', async (body) => {
    const result = await cancelCall()
      .set('Content-Type', 'application/json')
      .send(JSON.stringify(body))
      .expect(400);
    expect(result.body).toMatchObject({
      code: 'VALIDATION_FAILED',
      message: 'Invalid booking request',
    });
    expect(result.headers['cache-control']).toBe('no-store');
    expect(cancel).not.toHaveBeenCalled();
  });
  it.each(['{', 'false'])(
    'rejects malformed/primitive JSON %s',
    async (body) => {
      await cancelCall()
        .set('Content-Type', 'application/json')
        .send(body)
        .expect(400);
      expect(cancel).not.toHaveBeenCalled();
    },
  );
  it('rejects non-JSON payloads and invalid UUIDs', async () => {
    await cancelCall()
      .set('Content-Type', 'text/plain')
      .send('data')
      .expect(400);
    const result = await request(fixture.app.getHttpServer())
      .post('/api/bookings/not-a-uuid/cancel')
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
    expect(result.body.fieldErrors).toHaveProperty('id');
    expect(cancel).not.toHaveBeenCalled();
  });
  it('authenticates before ID/body/query validation or feature calls', async () => {
    for (const call of [
      () =>
        request(fixture.app.getHttpServer())
          .post('/api/bookings/not-a-uuid/cancel')
          .send({ userId: 'forged' }),
      () => request(fixture.app.getHttpServer()).get('/api/bookings/me?page=0'),
    ]) {
      const result = await call().expect(401);
      expect(result.body).toEqual({
        statusCode: 401,
        code: 'UNAUTHORIZED',
        message: 'Authentication required',
      });
      expect(result.headers['www-authenticate']).toBe('Bearer');
      expect(result.headers['cache-control']).toBe('no-store');
    }
    expect(cancel).not.toHaveBeenCalled();
    expect(mine).not.toHaveBeenCalled();
  });
  it.each([401, 404, 500, 503])(
    'preserves safe cancellation failure %i',
    async (status) => {
      const code =
        status === 401
          ? 'UNAUTHORIZED'
          : status === 404
            ? 'BOOKING_NOT_FOUND'
            : status === 503
              ? 'DATABASE_UNAVAILABLE'
              : 'INTERNAL_ERROR';
      const message =
        status === 401
          ? 'Authentication required'
          : status === 404
            ? 'Booking not found'
            : status === 503
              ? 'Database unavailable'
              : 'Unable to cancel booking';
      cancel.mockRejectedValue(new RegistrationError(status, code, message));
      const result = await cancelCall().expect(status);
      expect(result.body).toEqual({ statusCode: status, code, message });
      expect(result.headers['www-authenticate']).toBe(
        status === 401 ? 'Bearer' : undefined,
      );
      expect(result.headers['cache-control']).toBe('no-store');
    },
  );
  it('hides unexpected cancellation errors with the correct action message', async () => {
    cancel.mockRejectedValue(new Error('private exception'));
    expect((await cancelCall().expect(500)).body).toEqual({
      statusCode: 500,
      code: 'INTERNAL_ERROR',
      message: 'Unable to cancel booking',
    });
  });
  it.each([500, 503])('preserves private-list failure %i', async (status) => {
    mine.mockRejectedValue(
      new RegistrationError(
        status,
        status === 503 ? 'DATABASE_UNAVAILABLE' : 'INTERNAL_ERROR',
        status === 503 ? 'Database unavailable' : 'Unable to load bookings',
      ),
    );
    const result = await mineCall().expect(status);
    expect(result.headers['cache-control']).toBe('no-store');
    expect(result.headers['www-authenticate']).toBeUndefined();
  });
  it('documents private shapes, Bearer security, pagination, cancellation and headers', async () => {
    const doc = (
      await request(fixture.app.getHttpServer())
        .get('/swagger-json')
        .expect(200)
    ).body;
    const list = doc.paths['/api/bookings/me'].get;
    const mutation = doc.paths['/api/bookings/{id}/cancel'].post;
    for (const operation of [list, mutation]) {
      expect(operation.security).toEqual([{ 'access-token': [] }]);
      for (const status of ['200', '400', '401', '500', '503'])
        expect(operation.responses[status]).toBeDefined();
      expect(operation.responses['200'].headers['Cache-Control']).toBeDefined();
      expect(
        operation.responses['401'].headers['WWW-Authenticate'],
      ).toBeDefined();
    }
    expect(mutation.responses['404']).toBeDefined();
    expect(mutation.parameters).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'Idempotency-Key' }),
      ]),
    );
    expect(
      Object.keys(doc.components.schemas.MyBookingDto.properties).sort(),
    ).toEqual([...Object.keys(response), 'workshop'].sort());
    expect(
      Object.keys(doc.components.schemas.WorkshopResponseDto.properties),
    ).toHaveLength(7);
  });
});
