import { test, expect, login, reserve } from './fixtures.js';
import { workshopId } from './harness.js';
test.use({ releaseMode: true });
test('compiled single-server frontend reloads nested routes and retains API boundaries', async ({
  page,
  request,
  api,
}) => {
  await page.goto('/workshops/' + workshopId);
  await expect(
    page.getByRole('heading', {
      name: 'Synthetic browser workshop',
      exact: true,
    }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole('heading', {
      name: 'Synthetic browser workshop',
      exact: true,
    }),
  ).toBeVisible();
  const index = await request.get('/', { headers: { Accept: 'text/html' } });
  expect(index.status()).toBe(200);
  expect(index.headers()['cache-control']).toBe('no-cache');
  const assets = (await index.text()).match(
    /(?:src|href)="([^"]+\.(?:js|css))"/,
  );
  expect(assets).not.toBeNull();
  const asset = await request.get('/' + assets![1]);
  expect(asset.status()).toBe(200);
  expect(asset.headers()['cache-control']).toContain('immutable');
  for (const path of ['/api/unknown', '/missing.js', '/.env']) {
    const missing = await request.get(path, {
      headers: { Accept: 'text/html' },
    });
    expect(missing.status()).toBe(404);
    if (path.startsWith('/api/'))
      expect(missing.headers()['content-type'], path).toContain(
        'application/json',
      );
    expect(await missing.text(), path).not.toContain('<app-root');
  }
  expect((await request.get('/swagger-json')).status()).toBe(200);
  expect((await request.get('/api/health')).status()).toBe(200);
  await login(page);
  await reserve(page);
  expect((await api.counters()).active).toBe(1);
});
