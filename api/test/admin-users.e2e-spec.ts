import request from 'supertest';
import { JwtService } from '@nestjs/jwt';
import { vi } from 'vitest';
import { createTestApp } from './create-test-app.js';
import { AdminUsersService } from '../src/admin/admin-users.service.js';
import { RegistrationError } from '../src/auth/registration-error.js';

describe('Administrator user HTTP contracts', () => {
  let fixture: Awaited<ReturnType<typeof createTestApp>>, token: string;
  const user = {
    id: '580f2e1c-163b-4585-ad9e-62b842d17226',
    displayName: 'Administrator',
    email: 'admin@example.test',
    role: 'ADMIN' as const,
    isEnabled: true,
  };
  const sid = 'f425e920-6ab6-4d68-bd86-0b4bde115875';
  let list: ReturnType<typeof vi.spyOn>, update: ReturnType<typeof vi.spyOn>;
  beforeEach(async () => {
    fixture = await createTestApp();
    token = fixture.app
      .get(JwtService)
      .sign({ sub: user.id, sid }, { algorithm: 'HS256', expiresIn: 900 });
    fixture.sessionQuery.getOne.mockResolvedValue({
      id: sid,
      userId: user.id,
      expiresAt: new Date(Date.now() + 60000),
      revokedAt: null,
      user,
    });
    const service = fixture.app.get(AdminUsersService);
    list = vi
      .spyOn(service, 'list')
      .mockResolvedValue({ items: [user], total: 1, page: 1, limit: 25 });
    update = vi
      .spyOn(service, 'update')
      .mockResolvedValue({ ...user, role: 'USER', isEnabled: false });
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await fixture.app.close();
  });
  const get = (query = '') =>
    request(fixture.app.getHttpServer())
      .get('/api/admin/users' + query)
      .set('Authorization', 'Bearer ' + token);
  const patch = (body: unknown, id = user.id) =>
    request(fixture.app.getHttpServer())
      .patch('/api/admin/users/' + id + '/status')
      .set('Authorization', 'Bearer ' + token)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify(body));
  it('lists exactly safe fields with no-store and normalized combined filters', async () => {
    const result = await get(
      '?search=%20雪%20&status=enabled&page=2&limit=10',
    ).expect(200);
    expect(result.headers['cache-control']).toBe('no-store');
    expect(Object.keys(result.body.items[0]).sort()).toEqual([
      'displayName',
      'email',
      'id',
      'isEnabled',
      'role',
    ]);
    expect(list).toHaveBeenCalledWith({
      page: 2,
      limit: 10,
      search: '雪',
      status: 'enabled',
    });
  });
  it('accepts empty search as absent and 200 Unicode characters', async () => {
    await get('?search=%20').expect(200);
    expect(list).toHaveBeenLastCalledWith({ page: 1, limit: 25 });
    await get('?search=' + encodeURIComponent('😀'.repeat(200))).expect(200);
  });
  it.each([
    'page=0',
    'page=1.5',
    'page=2147483648',
    'limit=101',
    'limit=0',
    'status=all',
    'status=true',
    'role=ADMIN',
    'page=1&page=2',
    'search=a&search=b',
    'status=enabled&status=disabled',
    'search=' + encodeURIComponent('😀'.repeat(201)),
  ])('rejects query %s', async (query) => {
    const result = await get('?' + query).expect(400);
    expect(result.body.code).toBe('VALIDATION_FAILED');
    expect(result.body.message).toBe('Invalid user administration request');
    expect(result.headers['cache-control']).toBe('no-store');
    expect(list).not.toHaveBeenCalled();
  });
  it('accepts exactly boolean status and passes verified principal', async () => {
    const result = await patch({ isEnabled: false }).expect(200);
    expect(result.headers['cache-control']).toBe('no-store');
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ id: user.id, sessionId: sid }),
      user.id,
      false,
    );
  });
  it.each([
    {},
    null,
    [],
    false,
    42,
    'text',
    { isEnabled: null },
    { isEnabled: 'false' },
    { isEnabled: 0 },
    { isEnabled: false, role: 'ADMIN' },
    { isEnabled: false, userId: user.id },
  ])('rejects invalid status body %j', async (body) => {
    const result = await patch(body).expect(400);
    expect(result.body.code).toBe('VALIDATION_FAILED');
    expect(update).not.toHaveBeenCalled();
  });
  it('rejects invalid UUID and malformed JSON safely', async () => {
    await patch({ isEnabled: false }, 'unknown').expect(400);
    const result = await request(fixture.app.getHttpServer())
      .patch('/api/admin/users/' + user.id + '/status')
      .set('Content-Type', 'application/json')
      .send('{bad')
      .expect(400);
    expect(result.body.code).toBe('VALIDATION_FAILED');
  });
  it('requires Bearer authentication before authorization', async () => {
    const result = await request(fixture.app.getHttpServer())
      .get('/api/admin/users')
      .expect(401);
    expect(result.headers['www-authenticate']).toBe('Bearer');
    expect(result.headers['cache-control']).toBe('no-store');
    expect(list).not.toHaveBeenCalled();
  });
  it('rejects USER and disabled principals', async () => {
    fixture.sessionQuery.getOne.mockResolvedValue({
      id: sid,
      expiresAt: new Date(Date.now() + 60000),
      revokedAt: null,
      user: { ...user, role: 'USER' },
    });
    const result = await get().expect(403);
    expect(result.headers['www-authenticate']).toBeUndefined();
    fixture.sessionQuery.getOne.mockResolvedValue({
      id: sid,
      expiresAt: new Date(Date.now() + 60000),
      revokedAt: null,
      user: { ...user, isEnabled: false },
    });
    await get().expect(401);
  });
  it.each([
    [404, 'USER_NOT_FOUND', 'User not found'],
    [
      409,
      'ADMIN_ACCOUNT_PROTECTED',
      'Administrator accounts cannot be changed',
    ],
    [503, 'DATABASE_UNAVAILABLE', 'Database unavailable'],
    [401, 'UNAUTHORIZED', 'Authentication required'],
  ])('preserves safe status %s', async (status, code, message) => {
    update.mockRejectedValue(
      new RegistrationError(
        status as number,
        code as string,
        message as string,
      ),
    );
    const result = await patch({ isEnabled: false }).expect(status as number);
    expect(result.body).toEqual({ statusCode: status, code, message });
    expect(result.headers['cache-control']).toBe('no-store');
    if (status === 401)
      expect(result.headers['www-authenticate']).toBe('Bearer');
  });
  it('hides unexpected errors', async () => {
    update.mockRejectedValue(Error('private driver information'));
    const result = await patch({ isEnabled: false }).expect(500);
    expect(JSON.stringify(result.body)).not.toContain('private');
  });
  it('documents Bearer security, queries, body and errors', async () => {
    const doc = (
      await request(fixture.app.getHttpServer())
        .get('/swagger-json')
        .expect(200)
    ).body;
    const getOp = doc.paths['/api/admin/users'].get,
      patchOp = doc.paths['/api/admin/users/{id}/status'].patch;
    expect(getOp.security).toEqual([{ 'access-token': [] }]);
    expect(
      getOp.parameters.map((p: { name: string }) => p.name).sort(),
    ).toEqual(['limit', 'page', 'search', 'status']);
    expect(Object.keys(patchOp.responses)).toEqual(
      expect.arrayContaining([
        '200',
        '400',
        '401',
        '403',
        '404',
        '409',
        '500',
        '503',
      ]),
    );
    expect(patchOp.requestBody).toBeDefined();
  });
});
