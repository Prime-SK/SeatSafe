import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { createTestApp } from './create-test-app.js';

describe('Workshops API (e2e)', () => {
  let app: INestApplication<App>;
  let repository: Awaited<
    ReturnType<typeof createTestApp>
  >['workshopRepository'];

  beforeEach(async () => {
    ({ app, workshopRepository: repository } = await createTestApp());
  });

  afterEach(async () => {
    await app.close();
  });

  it('lists all workshops, including closed and sold-out workshops', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/workshops')
      .expect('Content-Type', /json/)
      .expect(200);

    expect(response.body).toEqual([
      {
        id: 'workshop-1',
        title: 'NestJS basics',
        capacity: 20,
        reservedSeats: 17,
        registrationOpen: true,
        availableSeats: 3,
        startsAt: '2026-11-01T10:00:00.000Z',
      },
      {
        id: 'workshop-2',
        title: 'Angular reactive forms',
        capacity: 10,
        reservedSeats: 2,
        registrationOpen: false,
        availableSeats: 8,
        startsAt: '2026-11-02T10:00:00.000Z',
      },
      {
        id: 'workshop-3',
        title: 'PostgreSQL transactions',
        capacity: 12,
        reservedSeats: 12,
        registrationOpen: true,
        availableSeats: 0,
        startsAt: '2026-11-03T10:00:00.000Z',
      },
    ]);
  });

  it('returns one workshop using the same shape as the list', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/workshops/workshop-1')
      .expect('Content-Type', /json/)
      .expect(200);

    expect(response.body).toEqual({
      id: 'workshop-1',
      title: 'NestJS basics',
      capacity: 20,
      reservedSeats: 17,
      registrationOpen: true,
      availableSeats: 3,
      startsAt: '2026-11-01T10:00:00.000Z',
    });
  });

  it('returns a standard 404 response for an unknown ID', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/workshops/unknown')
      .expect(404);

    expect(response.body).toEqual({
      message: 'Workshop not found',
      error: 'Not Found',
      statusCode: 404,
    });
  });

  it('does not expose workshop routes without the API prefix', async () => {
    await request(app.getHttpServer()).get('/workshops').expect(404);
  });

  it('returns an empty list when the repository has no rows', async () => {
    repository.find.mockResolvedValueOnce([]);
    await request(app.getHttpServer())
      .get('/api/workshops')
      .expect(200)
      .expect([]);
  });

  it.each(['/api/workshops', '/api/workshops/workshop-1'])(
    'returns a sanitized 503 for a failed query at %s',
    async (path) => {
      const query =
        path === '/api/workshops' ? repository.find : repository.findOneBy;
      query.mockRejectedValueOnce(
        new Error('private SQL and connection details'),
      );
      const response = await request(app.getHttpServer()).get(path).expect(503);
      expect(response.body).toEqual({
        statusCode: 503,
        message: 'Database unavailable',
        error: 'Service Unavailable',
      });
      expect(response.text).not.toContain('private SQL');
    },
  );
});
