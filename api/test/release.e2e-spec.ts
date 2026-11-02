import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import request from 'supertest';
import { Test } from '@nestjs/testing';
import { Controller, Get, Module } from '@nestjs/common';
import { installClient } from '../src/release/serve-client.js';
import { createTestApp } from './create-test-app.js';

@Controller('api')
class FixtureController {
  @Get('fixture') value() {
    return { api: true };
  }
}
@Module({ controllers: [FixtureController] })
class FixtureModule {}
describe('Release routing boundaries', () => {
  let directory: string, app: Awaited<ReturnType<typeof makeApp>>;
  async function makeApp() {
    const module = await Test.createTestingModule({
      imports: [FixtureModule],
    }).compile();
    const fixture = module.createNestApplication({ logger: false });
    installClient(fixture, directory);
    await fixture.init();
    return fixture;
  }
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'seatsafe-release-'));
    await writeFile(
      join(directory, 'index.html'),
      '<!doctype html><title>SeatSafe release fixture</title>',
    );
    await writeFile(
      join(directory, 'main-12345678.js'),
      '/* public fixture */',
    );
    await writeFile(join(directory, 'primeui-license.local.json'), '{}');
  });
  afterAll(async () => {
    const target = resolve(directory);
    if (
      !target.startsWith(resolve(tmpdir()) + '\\') &&
      !target.startsWith(resolve(tmpdir()) + '/')
    )
      throw Error('Invalid owned temporary path');
    await rm(target, { recursive: true });
  });
  beforeEach(async () => {
    app = await makeApp();
  });
  afterEach(async () => {
    await app.close();
  });
  it('serves HTML navigation and lets API routes retain JSON', async () => {
    await request(app.getHttpServer())
      .get('/admin/workshops/legacy/bookings')
      .set('Accept', 'text/html')
      .expect(200)
      .expect('Cache-Control', 'no-cache');
    expect(
      (await request(app.getHttpServer()).get('/api/fixture').expect(200)).body,
    ).toEqual({ api: true });
    await request(app.getHttpServer())
      .get('/api/missing')
      .set('Accept', 'text/html')
      .expect(404);
  });
  it.each([
    '/missing.js',
    '/primeui-missing.json',
    '/.env',
    '/swagger-missing.js',
    '/swagger',
    '/swagger-json',
  ])('never uses SPA fallback for %s', async (path) => {
    await request(app.getHttpServer())
      .get(path)
      .set('Accept', 'text/html')
      .expect(404);
  });
  it('does not turn POST/non-HTML requests into HTML', async () => {
    await request(app.getHttpServer())
      .post('/account')
      .set('Accept', 'text/html')
      .expect(404);
    await request(app.getHttpServer())
      .get('/account')
      .set('Accept', 'application/json')
      .expect(404);
  });
  it('caches hashed files and keeps the browser licence refreshable', async () => {
    await request(app.getHttpServer())
      .get('/main-12345678.js')
      .expect(200)
      .expect('Cache-Control', 'public, max-age=31536000, immutable');
    await request(app.getHttpServer())
      .get('/primeui-license.local.json')
      .expect(200)
      .expect('Cache-Control', 'no-store');
  });
  it('fails early on missing frontend artifacts', async () => {
    expect(() => installClient(app, join(directory, 'missing'))).toThrow(
      'frontend is missing',
    );
  });
});
describe('Trusted proxy rate-limit boundary', () => {
  it('uses the bounded right-side chain rather than forged prefixes', async () => {
    const fixture = await createTestApp();
    try {
      fixture.app.getHttpAdapter().getInstance().set('trust proxy', 3);
      for (let index = 0; index < 5; index++)
        await request(fixture.app.getHttpServer())
          .post('/api/auth/register')
          .set(
            'X-Forwarded-For',
            `198.51.100.${index + 1}, 203.0.113.7, 192.0.2.3, 10.0.0.2`,
          )
          .send({})
          .expect(400);
      await request(fixture.app.getHttpServer())
        .post('/api/auth/register')
        .set(
          'X-Forwarded-For',
          '198.51.100.250, 203.0.113.7, 192.0.2.3, 10.0.0.2',
        )
        .send({})
        .expect(429);
      await request(fixture.app.getHttpServer())
        .post('/api/auth/register')
        .set(
          'X-Forwarded-For',
          '198.51.100.250, 203.0.113.8, 192.0.2.3, 10.0.0.2',
        )
        .send({})
        .expect(400);
    } finally {
      await fixture.app.close();
    }
  });
});
