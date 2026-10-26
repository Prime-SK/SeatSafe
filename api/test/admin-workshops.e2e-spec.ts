import request from 'supertest';
import { JwtService } from '@nestjs/jwt';
import { vi } from 'vitest';
import { createTestApp } from './create-test-app.js';
import { AdminWorkshopsService } from '../src/admin/admin-workshops.service.js';

describe('Administrator workshop HTTP contracts', () => {
  let fixture: Awaited<ReturnType<typeof createTestApp>>;
  let token: string;
  const input = {
    title: '  Workshop with a clear title  ',
    capacity: 20,
    startsAt: '2040-05-01T15:30:00+05:30',
  };
  beforeEach(async () => {
    fixture = await createTestApp();
    token = fixture.app.get(JwtService).sign(
      {
        sub: '580f2e1c-163b-4585-ad9e-62b842d17226',
        sid: 'f425e920-6ab6-4d68-bd86-0b4bde115875',
      },
      { algorithm: 'HS256', expiresIn: 900 },
    );
    fixture.sessionQuery.getOne.mockResolvedValue({
      id: 'f425e920-6ab6-4d68-bd86-0b4bde115875',
      userId: '580f2e1c-163b-4585-ad9e-62b842d17226',
      expiresAt: new Date(Date.now() + 604800000),
      revokedAt: null,
      user: {
        id: '580f2e1c-163b-4585-ad9e-62b842d17226',
        displayName: 'Admin',
        email: 'admin@example.test',
        role: 'ADMIN',
        isEnabled: true,
      },
    });
    fixture.workshopQuery.getOne.mockResolvedValue({
      id: 'legacy-workshop',
      title: 'Existing',
      capacity: 10,
      reservedSeats: 3,
      registrationOpen: false,
      startsAt: new Date(input.startsAt),
    });
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await fixture.app.close();
  });
  const create = (body: object = input) =>
    request(fixture.app.getHttpServer())
      .post('/api/admin/workshops')
      .set('Authorization', 'Bearer ' + token)
      .send(body);
  const update = (body: object, id = 'legacy-workshop') =>
    request(fixture.app.getHttpServer())
      .patch('/api/admin/workshops/' + id)
      .set('Authorization', 'Bearer ' + token)
      .send(body);
  it('creates a normalized workshop with exactly seven safe fields', async () => {
    const result = await create().expect(201);
    expect(result.body).toEqual({
      id: expect.any(String),
      title: input.title.trim(),
      capacity: 20,
      reservedSeats: 0,
      registrationOpen: true,
      availableSeats: 20,
      startsAt: '2040-05-01T10:00:00.000Z',
    });
    expect(result.headers['cache-control']).toBe('no-store');
    expect(result.headers['set-cookie']).toBeUndefined();
  });
  it('updates only supplied fields without creation defaults', async () => {
    const result = await update({ title: '  Updated  ' }).expect(200);
    expect(result.body).toMatchObject({
      title: 'Updated',
      capacity: 10,
      reservedSeats: 3,
      registrationOpen: false,
    });
    expect(Object.keys(result.body).sort()).toEqual(
      [
        'id',
        'title',
        'capacity',
        'reservedSeats',
        'registrationOpen',
        'availableSeats',
        'startsAt',
      ].sort(),
    );
    expect(result.headers['cache-control']).toBe('no-store');
  });
  it.each([
    { title: '' },
    { title: '  ' },
    { title: '🔑'.repeat(201) },
    { title: 123 },
    { capacity: 0 },
    { capacity: -1 },
    { capacity: 1.5 },
    { capacity: 2147483648 },
    { capacity: '20' },
    { startsAt: '2040-05-01' },
    { startsAt: '2040-05-01T10:00:00' },
    { startsAt: '2040-02-30T10:00:00Z' },
    { startsAt: '2040-05-01T10:00:00+25:00' },
    { registrationOpen: 'true' },
    { id: 'supplied' },
    { reservedSeats: 1 },
    { availableSeats: 20 },
    { createdAt: input.startsAt },
    { userId: 'other' },
  ])('rejects invalid creation input: %j', async (override) => {
    const result = await create({ ...input, ...override }).expect(400);
    expect(result.body).toMatchObject({
      statusCode: 400,
      code: 'VALIDATION_FAILED',
      message: 'Invalid workshop data',
      fieldErrors: expect.any(Object),
    });
    expect(result.headers['cache-control']).toBe('no-store');
    expect(fixture.database.transaction).not.toHaveBeenCalled();
  });
  it.each(['title', 'capacity', 'startsAt', 'registrationOpen'])(
    'rejects explicit null for %s on create and PATCH',
    async (field) => {
      await create({ ...input, [field]: null }).expect(400);
      await update({ [field]: null }).expect(400);
      expect(fixture.database.transaction).not.toHaveBeenCalled();
    },
  );
  it.each(['title', 'capacity', 'startsAt'])(
    'requires creation field %s',
    async (field) => {
      const body: Record<string, unknown> = { ...input };
      delete body[field];
      await create(body).expect(400);
    },
  );
  it('accepts Unicode title bounds, maximum integer capacity and false registration', async () => {
    const result = await create({
      ...input,
      title: '🔑'.repeat(200),
      capacity: 2147483647,
      registrationOpen: false,
    }).expect(201);
    expect(result.body.title).toBe('🔑'.repeat(200));
    expect(result.body.registrationOpen).toBe(false);
  });
  it.each([
    {},
    { reservedSeats: 0 },
    { registrationOpen: 0 },
    { capacity: '5' },
    { startsAt: 'invalid' },
  ])('rejects malformed PATCH %j', async (body) => {
    await update(body).expect(400);
    expect(fixture.workshopRepository.update).not.toHaveBeenCalled();
  });
  it('returns the structured future-date validation error', async () => {
    const result = await create({
      ...input,
      startsAt: '2000-01-01T10:00:00Z',
    }).expect(400);
    expect(result.body.fieldErrors.startsAt).toEqual([
      'Workshop start must be in the future',
    ]);
  });
  it('returns safe capacity, missing-workshop and started-workshop errors', async () => {
    expect((await update({ capacity: 2 }).expect(409)).body.code).toBe(
      'CAPACITY_BELOW_RESERVED',
    );
    fixture.workshopQuery.getOne.mockResolvedValue({
      id: 'legacy-workshop',
      title: 'Past',
      capacity: 10,
      reservedSeats: 0,
      registrationOpen: false,
      startsAt: new Date('2000-01-01T10:00:00Z'),
    });
    expect(
      (await update({ registrationOpen: true }).expect(409)).body.code,
    ).toBe('WORKSHOP_ALREADY_STARTED');
    fixture.workshopQuery.getOne.mockResolvedValue(null);
    expect((await update({ title: 'Updated' }).expect(404)).body.code).toBe(
      'WORKSHOP_NOT_FOUND',
    );
  });
  it.each(['POST', 'PATCH'])(
    'requires authentication before %s validation or workshop writes',
    async (method) => {
      const call =
        method === 'POST'
          ? request(fixture.app.getHttpServer()).post('/api/admin/workshops')
          : request(fixture.app.getHttpServer()).patch(
              '/api/admin/workshops/legacy-workshop',
            );
      const result = await call.send({ capacity: 0 }).expect(401);
      expect(result.headers['www-authenticate']).toBe('Bearer');
      expect(result.headers['cache-control']).toBe('no-store');
      expect(fixture.database.transaction).not.toHaveBeenCalled();
    },
  );
  it('denies USER permission and disabled/revoked accounts before writes', async () => {
    const row = await fixture.sessionQuery.getOne();
    row.user.role = 'USER';
    const forbidden = await create().expect(403);
    expect(forbidden.body.code).toBe('FORBIDDEN');
    expect(forbidden.headers['www-authenticate']).toBeUndefined();
    row.user.role = 'ADMIN';
    row.user.isEnabled = false;
    await create().expect(401);
    row.user.isEnabled = true;
    row.revokedAt = new Date();
    await update({ title: 'Updated' }).expect(401);
    expect(fixture.database.transaction).not.toHaveBeenCalled();
  });
  it('sanitizes persistence and unexpected application errors', async () => {
    fixture.database.transaction.mockRejectedValue(
      new Error('private SQL/password'),
    );
    const unavailable = await create().expect(503);
    expect(unavailable.body).toEqual({
      statusCode: 503,
      code: 'DATABASE_UNAVAILABLE',
      message: 'Database unavailable',
    });
    vi.spyOn(
      fixture.app.get(AdminWorkshopsService),
      'create',
    ).mockRejectedValue(new Error('private internal details'));
    const failed = await create().expect(500);
    expect(failed.body).toEqual({
      statusCode: 500,
      code: 'INTERNAL_ERROR',
      message: 'Unable to create workshop',
    });
    expect(failed.headers['cache-control']).toBe('no-store');
  });
  it('documents security, editable fields, exact success contracts and failure headers', async () => {
    const doc = (
      await request(fixture.app.getHttpServer())
        .get('/swagger-json')
        .expect(200)
    ).body;
    for (const [path, method, success] of [
      ['/api/admin/workshops', 'post', '201'],
      ['/api/admin/workshops/{id}', 'patch', '200'],
    ]) {
      const operation = doc.paths[path][method];
      expect(operation.security).toEqual([{ 'access-token': [] }]);
      for (const code of [success, '400', '401', '403', '500', '503'])
        expect(
          operation.responses[code].headers['Cache-Control'],
        ).toBeDefined();
      expect(
        operation.responses[success].content['application/json'].schema.$ref,
      ).toBe('#/components/schemas/WorkshopResponseDto');
    }
    expect(
      doc.paths['/api/admin/workshops/{id}'].patch.responses['409'].content[
        'application/json'
      ].examples,
    ).toHaveProperty('capacity');
    expect(doc.components.schemas.CreateWorkshopDto.required.sort()).toEqual([
      'capacity',
      'startsAt',
      'title',
    ]);
    expect(doc.components.schemas.UpdateWorkshopDto.required ?? []).toEqual([]);
    expect(doc.paths['/api/admin/workshops/{id}/bookings']).toBeUndefined();
  });
});
