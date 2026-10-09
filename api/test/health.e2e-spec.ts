import request from 'supertest';
import { createTestApp } from './create-test-app.js';

describe('Database health (e2e)', () => {
  let fixture: Awaited<ReturnType<typeof createTestApp>>;

  beforeEach(async () => {
    fixture = await createTestApp();
  });
  afterEach(async () => {
    await fixture.app.close();
  });

  it('queries the database before reporting a healthy connection', async () => {
    await request(fixture.app.getHttpServer())
      .get('/api/health')
      .expect(200)
      .expect({ status: 'ok', database: 'up' });
    expect(fixture.database.query).toHaveBeenCalledExactlyOnceWith('SELECT 1');
  });

  it('returns a sanitized 503 response when the query rejects', async () => {
    fixture.database.query.mockRejectedValueOnce(
      new Error('private-driver-details'),
    );
    const response = await request(fixture.app.getHttpServer())
      .get('/api/health')
      .expect(503);
    expect(response.body).toEqual({
      statusCode: 503,
      message: 'Database unavailable',
      error: 'Service Unavailable',
    });
    expect(response.text).not.toContain('private-driver-details');
  });

  it('closes the supplied data source when the application shuts down', async () => {
    await fixture.app.close();
    expect(fixture.database.destroy).toHaveBeenCalledOnce();
  });
});
