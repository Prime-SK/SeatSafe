import request from 'supertest';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'node:crypto';
import { vi } from 'vitest';
import { createTestApp } from './create-test-app.js';
import { LabService } from '../src/reliability/lab.service.js';
import { newReport } from '../src/reliability/lab-runner.js';
describe('Local lab HTTP contracts', () => {
  let f: Awaited<ReturnType<typeof createTestApp>>,
    token: string,
    lab: LabService;
  const uid = randomUUID(),
    sid = randomUUID(),
    runId = randomUUID();
  beforeEach(async () => {
    f = await createTestApp();
    lab = f.app.get(LabService);
    token = f.app
      .get(JwtService)
      .sign({ sub: uid, sid }, { algorithm: 'HS256', expiresIn: 900 });
    f.sessionQuery.getOne.mockResolvedValue({
      id: sid,
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60000),
      user: {
        id: uid,
        displayName: 'Admin',
        email: 'admin@example.test',
        role: 'ADMIN',
        isEnabled: true,
      },
    });
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await f.app.close();
  });
  const get = (path: string) =>
    request(f.app.getHttpServer())
      .get('/api/admin/reliability/' + path)
      .set('Authorization', 'Bearer ' + token);
  const start = (body: unknown) =>
    request(f.app.getHttpServer())
      .post('/api/admin/reliability/runs')
      .set('Authorization', 'Bearer ' + token)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify(body));
  it('reports disabled capabilities without creating fixtures and keeps execution 404', async () => {
    const result = await get('capabilities').expect(200);
    expect(result.body).toEqual({ enabled: false, scenarios: [] });
    expect(result.headers['cache-control']).toBe('no-store');
    await start({ runId, scenario: 'matching-key' }).expect(404);
    await get('runs/' + runId).expect(404);
  });
  it('requires ADMIN authentication for capabilities', async () => {
    await request(f.app.getHttpServer())
      .get('/api/admin/reliability/capabilities')
      .expect(401);
    f.sessionQuery.getOne.mockResolvedValue({
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60000),
      user: { id: uid, isEnabled: true, role: 'USER' },
    });
    await get('capabilities').expect(403);
  });
  it('starts only exact fixed scenarios with the verified owner', async () => {
    vi.spyOn(lab, 'enabled').mockReturnValue(true);
    const saved = vi
      .spyOn(lab, 'start')
      .mockReturnValue(newReport(runId, 'matching-key'));
    const result = await start({ runId, scenario: 'matching-key' }).expect(202);
    expect(saved).toHaveBeenCalledWith(uid, runId, 'matching-key');
    expect(result.body.workers).toBe(9);
    expect(result.headers['cache-control']).toBe('no-store');
  });
  it.each([
    null,
    [],
    true,
    {},
    { runId: 'invalid', scenario: 'matching-key' },
    { runId, scenario: 'unsafe' },
    { runId, scenario: 'matching-key', schema: 'public' },
    { runId, scenario: 'matching-key', userId: uid },
  ])('rejects malformed input %j', async (body) => {
    vi.spyOn(lab, 'enabled').mockReturnValue(true);
    const result = await start(body).expect(400);
    expect(result.body.code).toBe('VALIDATION_FAILED');
  });
  it('validates run IDs and hides missing/foreign history', async () => {
    vi.spyOn(lab, 'enabled').mockReturnValue(true);
    await get('runs/invalid').expect(400);
    expect((await get('runs/' + runId).expect(404)).body.code).toBe(
      'LAB_RUN_NOT_FOUND',
    );
  });
  it('keeps Swagger bearer requirements and response models', async () => {
    const doc = (await request(f.app.getHttpServer()).get('/swagger-json'))
      .body;
    const operation = doc.paths['/api/admin/reliability/runs'].post;
    expect(operation.security).toEqual([{ 'access-token': [] }]);
    expect(
      operation.responses['202'].content['application/json'].schema.properties
        .attempts,
    ).toBeDefined();
  });
});
