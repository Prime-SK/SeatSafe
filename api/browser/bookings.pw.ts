import {
  test,
  expect,
  login,
  details,
  reserve,
  confirmCancel,
} from './fixtures.js';
import { password, learner, workshopId } from './harness.js';
import type { Route } from '@playwright/test';

test('registration, restart persistence, booking history and logout', async ({
  page,
  api,
}, info) => {
  await page.goto('/register');
  await page
    .getByLabel('Display name', { exact: true })
    .fill('Registered browser learner');
  await page
    .getByLabel('Email', { exact: true })
    .fill('registered@example.test');
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByLabel('Confirm password', { exact: true }).fill(password);
  await page
    .getByRole('button', { name: 'Create account', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Account created', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Sign out', exact: true }),
  ).toHaveCount(0);
  await login(page, 'registered@example.test');
  await reserve(page);
  expect(await api.counters()).toEqual({ active: 1, reserved: 1, records: 1 });
  await api.restart();
  await page.reload();
  await expect(
    page.getByText('Your seat is reserved.', { exact: true }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Account', exact: true }).click();
  await expect(
    page.getByText('registered@example.test', { exact: true }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'My bookings', exact: true }).click();
  await expect(page.getByText('Seat reserved', { exact: true })).toBeVisible();
  await confirmCancel(page);
  await expect(
    page.getByRole('button', { name: 'Cancel booking', exact: true }),
  ).toHaveCount(0);
  expect(await api.counters()).toEqual({ active: 0, reserved: 0, records: 1 });
  await reserve(page);
  expect(await api.counters()).toEqual({ active: 1, reserved: 1, records: 2 });
  await page.screenshot({
    path: info.outputPath('reserved.png'),
    animations: 'disabled',
  });
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(
    page.getByRole('link', { name: 'Sign in', exact: true }),
  ).toBeVisible();
  await page.goto('/account');
  await expect(page).toHaveURL(/\/login$/);
});

test('committed reservation with lost response recovers the original key after reload', async ({
  page,
  api,
}) => {
  await login(page);
  await details(page);
  let originalKey = '';
  await page.route(
    '**/api/workshops/*/bookings',
    async (route) => {
      originalKey = route.request().headers()['idempotency-key']!;
      const response = await route.fetch({ maxRetries: 0 });
      expect(response.status()).toBe(201);
      await route.abort('failed');
    },
    { times: 1 },
  );
  await page
    .getByRole('button', { name: 'Reserve one seat', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Retry reservation', exact: true }),
  ).toBeVisible();
  expect(await api.counters()).toEqual({ active: 1, reserved: 1, records: 1 });
  await page.reload();
  const replay = page.waitForRequest(
    (request) =>
      request.method() === 'POST' && request.url().endsWith('/bookings'),
  );
  await page
    .getByRole('button', { name: 'Retry reservation', exact: true })
    .click();
  expect((await replay).headers()['idempotency-key']).toBe(originalKey);
  await expect(
    page.getByText('Your seat is reserved.', { exact: true }),
  ).toBeVisible();
  expect(await api.counters()).toEqual({ active: 1, reserved: 1, records: 1 });
});

test('uncertain cancellation is deliberately repeatable without another seat release', async ({
  page,
  api,
}) => {
  await login(page);
  await reserve(page);
  await page.route(
    '**/api/bookings/*/cancel',
    async (route) => {
      const response = await route.fetch({ maxRetries: 0 });
      expect(response.status()).toBe(200);
      await route.abort('failed');
    },
    { times: 1 },
  );
  await confirmCancel(page);
  await expect(
    page.getByRole('button', { name: 'Retry cancellation', exact: true }),
  ).toBeVisible();
  const [before] = await api.database.query(
    `SELECT cancelled_at FROM "${api.schema}".bookings`,
  );
  const retry = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      response.url().endsWith('/cancel'),
  );
  await page
    .getByRole('button', { name: 'Retry cancellation', exact: true })
    .click();
  expect((await retry).status()).toBe(200);
  const [after] = await api.database.query(
    `SELECT cancelled_at FROM "${api.schema}".bookings`,
  );
  expect(after.cancelled_at).toEqual(before.cancelled_at);
  expect(await api.counters()).toEqual({ active: 0, reserved: 0, records: 1 });
});

test('two tabs coordinate restoration, on-demand expiry refresh and logout', async ({
  page,
  context,
  api,
}) => {
  await login(page);
  const second = await context.newPage();
  try {
    await second.goto('/account');
    await expect(second.getByText(learner, { exact: true })).toBeVisible();
    await Promise.all([page.reload(), second.reload()]);
    await expect(second.getByText(learner, { exact: true })).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Sign out', exact: true }),
    ).toBeVisible();
    await page.clock.install();
    await page.clock.fastForward(901000);
    const refresh = page.waitForResponse(
      (response) =>
        response.url().endsWith('/auth/refresh') &&
        response.request().method() === 'POST',
    );
    await page.getByRole('link', { name: 'Account', exact: true }).click();
    expect((await refresh).status()).toBe(200);
    await expect(page.getByText(learner, { exact: true })).toBeVisible();
    const [session] = await api.database.query(
      `SELECT count(*)::int AS total FROM "${api.schema}".auth_sessions WHERE revoked_at IS NULL`,
    );
    expect(session.total).toBe(1);
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(
      second.getByRole('button', { name: 'Sign out', exact: true }),
    ).toHaveCount(0);
    await second.goto('/account');
    await expect(second).toHaveURL(/\/login$/);
  } finally {
    await second.close();
  }
});

test('two distinct browser accounts compete for the final seat', async ({
  page,
  browser,
  api,
}) => {
  await api.database.query(
    `UPDATE "${api.schema}".workshops SET capacity=1 WHERE id=$1`,
    [workshopId],
  );
  const otherContext = await browser.newContext({
    baseURL: 'http://127.0.0.1:4201',
  });
  const other = await otherContext.newPage();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const waiting: Route[] = [];
  let release!: () => void;
  let rejectBarrier!: (error: Error) => void;
  const both = new Promise<void>((resolve, reject) => {
    release = resolve;
    rejectBarrier = reject;
  });
  void both.catch(() => undefined);
  const barrier = async (route: Route) => {
    waiting.push(route);
    timer ??= setTimeout(
      () => rejectBarrier(Error('Two-browser reservation barrier timed out')),
      8000,
    );
    if (waiting.length === 2) {
      clearTimeout(timer);
      release();
    }
    await both;
    await route.continue();
  };
  try {
    await login(page);
    await login(other, 'other@example.test');
    await details(page);
    await details(other);
    await page.route('**/api/workshops/*/bookings', barrier);
    await other.route('**/api/workshops/*/bookings', barrier);
    const results = [
      page.waitForResponse(
        (r) => r.request().method() === 'POST' && r.url().endsWith('/bookings'),
      ),
      other.waitForResponse(
        (r) => r.request().method() === 'POST' && r.url().endsWith('/bookings'),
      ),
    ];
    await Promise.all([
      page
        .getByRole('button', { name: 'Reserve one seat', exact: true })
        .click(),
      other
        .getByRole('button', { name: 'Reserve one seat', exact: true })
        .click(),
    ]);
    expect(
      (await Promise.all(results)).map((r) => r.status()).sort((a, b) => a - b),
    ).toEqual([201, 409]);
    expect(waiting).toHaveLength(2);
    expect(await api.counters()).toEqual({
      active: 1,
      reserved: 1,
      records: 2,
    });
    await expect
      .poll(async () =>
        (
          await Promise.all([
            page.locator('main').innerText(),
            other.locator('main').innerText(),
          ])
        ).join(' '),
      )
      .toContain('Your seat is reserved.');
    await expect
      .poll(async () =>
        (
          await Promise.all([
            page.locator('main').innerText(),
            other.locator('main').innerText(),
          ])
        )
          .join(' ')
          .toLowerCase(),
      )
      .toContain('full');
  } finally {
    if (timer) clearTimeout(timer);
    release();
    await otherContext.close();
  }
});
