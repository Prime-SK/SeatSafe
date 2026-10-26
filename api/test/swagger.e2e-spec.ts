import type { INestApplication } from '@nestjs/common';
import type { OpenAPIObject } from '@nestjs/swagger';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { createTestApp } from './create-test-app.js';

describe('Swagger documentation (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    ({ app } = await createTestApp());
  });

  afterEach(async () => {
    await app.close();
  });

  it('serves Swagger UI and its JavaScript outside the API prefix', async () => {
    const response = await request(app.getHttpServer())
      .get('/swagger/')
      .expect('Content-Type', /html/)
      .expect(200);

    expect(response.text).toContain('swagger-ui');
    await request(app.getHttpServer())
      .get('/swagger/swagger-ui-bundle.js')
      .expect(200);
    await request(app.getHttpServer()).get('/api/swagger').expect(404);
  });

  it('documents all current endpoints with the real API prefix', async () => {
    const response = await request(app.getHttpServer())
      .get('/swagger-json')
      .expect('Content-Type', /json/)
      .expect(200);
    const document = response.body as OpenAPIObject;

    expect(document.info).toMatchObject({
      title: 'SeatSafe API',
      version: '0.1.0',
    });
    expect(Object.keys(document.paths).sort()).toEqual([
      '/api',
      '/api/admin/access',
      '/api/admin/workshops',
      '/api/admin/workshops/{id}',
      '/api/auth/login',
      '/api/auth/logout',
      '/api/auth/me',
      '/api/auth/refresh',
      '/api/auth/register',
      '/api/health',
      '/api/workshops',
      '/api/workshops/{id}',
    ]);
    expect(document.paths['/api']?.get?.responses['200']).toMatchObject({
      content: {
        'text/plain': { schema: { type: 'string', example: 'Hello World!' } },
      },
    });
    expect(document.paths['/api/health']?.get).toMatchObject({
      tags: ['Health'],
      responses: {
        '200': {
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/HealthResponseDto' },
            },
          },
        },
        '503': {
          content: {
            'application/json': {
              schema: {
                properties: { message: { example: 'Database unavailable' } },
              },
            },
          },
        },
      },
    });
    expect(document.paths['/api/workshops']?.get).toMatchObject({
      tags: ['Workshops'],
      responses: {
        '200': {
          content: {
            'application/json': {
              schema: {
                type: 'array',
                items: { $ref: '#/components/schemas/WorkshopResponseDto' },
              },
            },
          },
        },
      },
    });
    expect(document.paths['/api/workshops/{id}']?.get).toMatchObject({
      tags: ['Workshops'],
      parameters: [
        {
          name: 'id',
          in: 'path',
          required: true,
          schema: { type: 'string', example: 'workshop-1' },
        },
      ],
      responses: {
        '200': {
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/WorkshopResponseDto' },
            },
          },
        },
        '404': {
          content: {
            'application/json': {
              schema: {
                properties: { statusCode: { type: 'integer', example: 404 } },
              },
            },
          },
        },
      },
    });
    expect(document.components?.schemas?.['WorkshopResponseDto']).toMatchObject(
      {
        type: 'object',
        required: [
          'startsAt',
          'id',
          'title',
          'capacity',
          'reservedSeats',
          'registrationOpen',
          'availableSeats',
        ],
        properties: {
          startsAt: { type: 'string', format: 'date-time' },
          id: { type: 'string', example: 'workshop-1' },
          title: { type: 'string' },
          capacity: { type: 'number' },
          registrationOpen: { type: 'boolean' },
          reservedSeats: { type: 'number', example: 0 },
          availableSeats: { type: 'number', example: 20 },
        },
      },
    );
    for (const path of ['/api/workshops', '/api/workshops/{id}']) {
      expect(document.paths[path]?.get?.responses['503']).toMatchObject({
        content: {
          'application/json': {
            schema: {
              properties: {
                statusCode: { type: 'integer', example: 503 },
                message: { type: 'string', example: 'Database unavailable' },
                error: { type: 'string', example: 'Service Unavailable' },
              },
            },
          },
        },
      });
    }
    expect(
      Object.keys(
        (
          document.components!.schemas!['WorkshopResponseDto'] as {
            properties: object;
          }
        ).properties,
      ),
    ).toEqual([
      'startsAt',
      'id',
      'title',
      'capacity',
      'reservedSeats',
      'registrationOpen',
      'availableSeats',
    ]);
  });
});
