import { randomUUID } from 'node:crypto';
import {
  test,
  expect,
  login,
  reserve,
  confirmCancel,
  noOverflow,
} from './fixtures.js';
import { administrator, learner, workshopId } from './harness.js';
import { BookingEntity } from '../dist/bookings/booking.entity.js';

test('administrator attendee history, pagination, responsive layout and permission loss', async ({
  page,
  browser,
  api,
}, info) => {
  await login(page);
  await reserve(page);
  await confirmCancel(page);
  await expect(
    page.getByText('Your seat is reserved.', { exact: true }),
  ).toHaveCount(0);
  await reserve(page);
  const [user] = await api.database.query(
    `SELECT id FROM "${api.schema}".users WHERE email=$1`,
    [learner],
  );
  const longName = 'Synthetic attendee ' + 'W'.repeat(75);
  await api.database.query(
    `UPDATE "${api.schema}".users SET display_name=$1 WHERE id=$2`,
    [longName, user.id],
  );
  const addHistory = () =>
    api.database.getRepository(BookingEntity).insert(
      Array.from({ length: 26 }, (_, index) => ({
        id: randomUUID(),
        userId: user.id,
        workshopId,
        status: 'CANCELLED' as const,
        createdAt: new Date(Date.now() - (index + 1) * 60000),
        cancelledAt: new Date(),
      })),
    );
  const context = await browser.newContext({
    baseURL: 'http://127.0.0.1:4201',
    viewport: { width: 1280, height: 1000 },
  });
  const admin = await context.newPage();
  try {
    await login(admin, administrator);
    await admin
      .getByRole('link', { name: 'Manage workshops', exact: true })
      .click();
    const read = admin.waitForRequest(
      (request) =>
        request.url().includes('/api/admin/workshops/') &&
        request.url().includes('/bookings?'),
    );
    await admin
      .getByRole('link', {
        name: 'Bookings for Synthetic browser workshop',
        exact: true,
      })
      .filter({ visible: true })
      .click();
    expect(
      Boolean((await read).headers()['authorization']?.startsWith('Bearer ')),
    ).toBe(true);
    await expect(
      admin.getByRole('heading', { name: 'Workshop bookings', exact: true }),
    ).toBeVisible();
    await expect(
      admin.getByText('2 bookings in this workshop’s history', {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      admin.getByText(learner).filter({ visible: true }).first(),
    ).toBeVisible();
    // Public handover screenshots use only synthetic fixture identities.
    await api.database.query(
      `UPDATE "${api.schema}".users SET display_name=$1 WHERE id=$2`,
      ['Synthetic attendee', user.id],
    );
    await admin
      .getByRole('button', { name: 'Refresh bookings', exact: true })
      .click();
    await expect(admin.getByText(longName)).toHaveCount(0);
    await admin.screenshot({
      path: info.outputPath('public-attendees-desktop.png'),
      animations: 'disabled',
    });
    await admin.setViewportSize({ width: 390, height: 1000 });
    await admin.screenshot({
      path: info.outputPath('public-attendees-mobile.png'),
      animations: 'disabled',
    });
    await api.database.query(
      `UPDATE "${api.schema}".users SET display_name=$1 WHERE id=$2`,
      [longName, user.id],
    );
    await admin
      .getByRole('button', { name: 'Refresh bookings', exact: true })
      .click();
    await expect(
      admin.getByText(longName).filter({ visible: true }).first(),
    ).toBeVisible();
    for (const width of [1280, 1024, 768, 390, 320]) {
      await admin.setViewportSize({ width, height: 1000 });
      await noOverflow(admin);
      expect(await admin.evaluate(() => innerWidth)).toBe(width);
      await admin.screenshot({
        path: info.outputPath(`attendees-${width}.png`),
        animations: 'disabled',
      });
    }
    await admin.setViewportSize({ width: 1280, height: 1000 });
    await addHistory();
    await admin
      .getByRole('button', { name: 'Refresh bookings', exact: true })
      .click();
    await expect(
      admin.getByText('28 bookings in this workshop’s history', {
        exact: true,
      }),
    ).toBeVisible();
    await admin.goto(`/admin/workshops/${workshopId}/bookings?page=2&limit=10`);
    await expect(
      admin.getByText('28 bookings in this workshop’s history', {
        exact: true,
      }),
    ).toBeVisible();
    await expect(admin).toHaveURL(/page=2&limit=10/);
    await admin
      .locator('p-paginator')
      .getByRole('button', { name: /next/i })
      .click();
    await expect(admin).toHaveURL(/page=3&limit=10/);
    await expect(
      admin.getByText('Active', { exact: true }).filter({ visible: true }),
    ).toBeVisible();
    await admin.goto(
      `/admin/workshops/${workshopId}/bookings?page=bad&limit=999&userId=forged`,
    );
    await expect(admin).toHaveURL(/page=1&limit=25$/);
    await expect(
      admin.getByText(learner).filter({ visible: true }).first(),
    ).toBeVisible();
    await api.database.query(
      `UPDATE "${api.schema}".users SET role='USER' WHERE email=$1`,
      [administrator],
    );
    await admin
      .getByRole('button', { name: 'Refresh bookings', exact: true })
      .click();
    await expect(admin).toHaveURL(/\/admin\/access$/);
    await expect(admin.getByText(learner)).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test('empty attendee history recovers safely from an unavailable read', async ({
  page,
}) => {
  await login(page, administrator);
  await page
    .getByRole('link', { name: 'Manage workshops', exact: true })
    .click();
  await page
    .getByRole('link', {
      name: 'Bookings for Synthetic browser workshop',
      exact: true,
    })
    .filter({ visible: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'No bookings yet', exact: true }),
  ).toBeVisible();
  await page.route(
    /\/api\/admin\/workshops\/[^/]+\/bookings\?/,
    (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'PRIVATE fixture error' }),
      }),
    { times: 1 },
  );
  await page
    .getByRole('button', { name: 'Refresh bookings', exact: true })
    .click();
  await expect(
    page.getByText('Workshop bookings are unavailable. Please try again.', {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText('PRIVATE fixture error', { exact: true }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'No bookings yet', exact: true }),
  ).toBeVisible();
});
