import { test, expect, login } from './fixtures.js';
import { administrator, learner } from './harness.js';

test('administrator scheduling respects Colombo time and ordinary users are denied', async ({
  browser,
  page,
  api,
}) => {
  const adminContext = await browser.newContext({
    baseURL: 'http://127.0.0.1:4201',
    timezoneId: 'America/New_York',
  });
  const admin = await adminContext.newPage();
  try {
    await login(admin, administrator);
    await admin
      .getByRole('link', { name: 'Manage workshops', exact: true })
      .click();
    await admin
      .getByRole('link', { name: 'Create workshop', exact: true })
      .click();
    await admin
      .getByLabel('Workshop title', { exact: true })
      .fill('Created through browser');
    await admin.getByLabel('Capacity', { exact: true }).fill('3');
    const future = new Date(Date.now() + 21 * 86400000);
    const day = `${String(future.getUTCDate()).padStart(2, '0')}/${String(future.getUTCMonth() + 1).padStart(2, '0')}/${future.getUTCFullYear()}`;
    await admin
      .getByLabel('Start date and time', { exact: true })
      .fill(day + ' 14:00');
    await admin.getByLabel('Start date and time', { exact: true }).press('Tab');
    await admin
      .getByRole('button', { name: 'Save workshop', exact: true })
      .click();
    await expect(admin).toHaveURL(/\/admin\/workshops$/);
    let [row] = await api.database.query(
      `SELECT id, starts_at FROM "${api.schema}".workshops WHERE title=$1`,
      ['Created through browser'],
    );
    const expected = new Date(
      Date.UTC(
        future.getUTCFullYear(),
        future.getUTCMonth(),
        future.getUTCDate(),
        8,
        30,
      ),
    );
    expect(row.starts_at.toISOString()).toBe(expected.toISOString());
    const id = row.id as string;
    await admin
      .locator(`a[href="/admin/workshops/${id}/edit"]`)
      .filter({ visible: true })
      .click();
    await admin
      .getByLabel('Workshop title', { exact: true })
      .fill('Edited through browser');
    await admin
      .getByRole('switch', { name: 'Registration open', exact: true })
      .uncheck();
    await admin
      .getByRole('button', { name: 'Save workshop', exact: true })
      .click();
    await expect(admin).toHaveURL(/\/admin\/workshops$/);
    await page.goto('/workshops/' + id);
    await expect(
      page.getByText('Registration closed', { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', {
        name: 'Edited through browser',
        exact: true,
      }),
    ).toBeVisible();
    await admin
      .locator(`a[href="/admin/workshops/${id}/edit"]`)
      .filter({ visible: true })
      .click();
    await admin
      .getByRole('switch', { name: 'Registration open', exact: true })
      .check();
    await admin
      .getByRole('button', { name: 'Save workshop', exact: true })
      .click();
    await expect(admin).toHaveURL(/\/admin\/workshops$/);
    [row] = await api.database.query(
      `SELECT starts_at, registration_open FROM "${api.schema}".workshops WHERE id=$1`,
      [id],
    );
    expect(row.starts_at.toISOString()).toBe(expected.toISOString());
    expect(row.registration_open).toBe(true);
    await page.reload();
    await expect(
      page.getByText('Registration open', { exact: true }),
    ).toBeVisible();
    await login(page);
    await page.goto('/admin/workshops');
    await expect(page).toHaveURL(/\/admin\/access$/);
    await expect(
      page.getByText(
        'Your account does not have permission to manage SeatSafe.',
        { exact: true },
      ),
    ).toBeVisible();
  } finally {
    await adminContext.close();
  }
});

test('administrator filters, disables and enables USER without reviving old sessions', async ({
  page,
  browser,
  api,
}) => {
  const learnerContext = await browser.newContext({
    baseURL: 'http://127.0.0.1:4201',
  });
  const user = await learnerContext.newPage();
  try {
    await login(user);
    await login(page, administrator);
    await page.getByRole('link', { name: 'Manage users', exact: true }).click();
    await expect(
      page
        .getByText('Protected administrator', { exact: true })
        .filter({ visible: true }),
    ).toBeVisible();
    await page
      .getByLabel('Search name or email', { exact: true })
      .fill(learner);
    await page
      .getByRole('combobox', { name: 'Account status', exact: true })
      .click();
    await page.getByRole('option', { name: 'Enabled', exact: true }).click();
    await page
      .getByRole('button', { name: 'Apply filters', exact: true })
      .click();
    await expect(page).toHaveURL(
      /search=learner(?:@|%40)example.test.*status=enabled/,
    );
    await page
      .getByRole('button', { name: 'Disable account: ' + learner, exact: true })
      .filter({ visible: true })
      .click();
    const dialog = page.getByRole('alertdialog', {
      name: 'Disable this account?',
      exact: true,
    });
    await expect(
      dialog.getByRole('button', { name: 'Keep enabled', exact: true }),
    ).toBeFocused();
    await dialog
      .getByRole('button', { name: 'Disable account', exact: true })
      .click();
    await expect(
      page.getByRole('button', {
        name: 'Disable account: ' + learner,
        exact: true,
      }),
    ).toHaveCount(0);
    await expect
      .poll(
        async () =>
          (
            await api.database.query(
              `SELECT is_enabled FROM "${api.schema}".users WHERE email=$1`,
              [learner],
            )
          )[0].is_enabled,
      )
      .toBe(false);
    const denied = user.waitForResponse(
      (response) =>
        response.url().endsWith('/auth/me') && response.status() === 401,
    );
    await user.getByRole('link', { name: 'Account', exact: true }).click();
    await denied;
    await expect(
      user
        .getByRole('navigation')
        .getByRole('link', { name: 'Sign in', exact: true }),
    ).toBeVisible();
    await expect(user.getByText(learner, { exact: true })).toHaveCount(0);
    await page
      .locator('form')
      .getByRole('button', { name: 'Clear filters', exact: true })
      .click();
    await page
      .getByRole('button', { name: 'Enable account: ' + learner, exact: true })
      .filter({ visible: true })
      .click();
    await expect
      .poll(
        async () =>
          (
            await api.database.query(
              `SELECT is_enabled FROM "${api.schema}".users WHERE email=$1`,
              [learner],
            )
          )[0].is_enabled,
      )
      .toBe(true);
    const old = await api.database.query(
      `SELECT revoked_at FROM "${api.schema}".auth_sessions s JOIN "${api.schema}".users u ON u.id=s.user_id WHERE u.email=$1`,
      [learner],
    );
    expect(old.length).toBe(1);
    expect(
      old.every((row: { revoked_at: Date | null }) => row.revoked_at !== null),
    ).toBe(true);
    await user.reload();
    await expect(
      user.getByRole('link', { name: 'Account', exact: true }),
    ).toHaveCount(0);
    await login(user);
    await user.getByRole('link', { name: 'Account', exact: true }).click();
    await expect(user.getByText(learner, { exact: true })).toBeVisible();
    expect(
      (
        await api.database.query(
          `SELECT count(*)::int AS count FROM "${api.schema}".auth_sessions s JOIN "${api.schema}".users u ON u.id=s.user_id WHERE u.email=$1 AND s.revoked_at IS NULL`,
          [learner],
        )
      )[0].count,
    ).toBe(1);
  } finally {
    await learnerContext.close();
  }
});

test.describe('local reliability lab integration', () => {
  test.use({ labEnabled: true });
  test('matching replay cleans up; disabled presentation cannot start a new run', async ({
    page,
    api,
  }) => {
    await login(page, administrator);
    await page
      .getByRole('link', { name: 'Reliability lab', exact: true })
      .click();
    await page
      .getByRole('combobox', { name: 'Demonstration', exact: true })
      .click();
    await page
      .getByRole('option', { name: 'Matching-key replay', exact: true })
      .click();
    let starts = 0;
    page.on('request', (request) => {
      if (
        request.method() === 'POST' &&
        request.url().endsWith('/reliability/runs')
      )
        starts++;
    });
    await page
      .getByRole('button', { name: 'Run selected demonstration', exact: true })
      .click();
    await expect(
      page.getByText(
        'Observed invariants passed and isolated data was removed',
        { exact: true },
      ),
    ).toBeVisible();
    await expect(page.getByText('removed', { exact: true })).toBeVisible();
    await expect(
      page.locator('dl').getByText('20', { exact: true }),
    ).toBeVisible();
    expect(
      (
        await api.control.query(
          "SELECT count(*)::int AS count FROM pg_namespace WHERE nspname LIKE 'seatsafe_lab_%'",
        )
      )[0].count,
    ).toBe(0);
    await page.reload();
    await expect(page.getByText('removed', { exact: true })).toBeVisible();
    expect(starts).toBe(1);
    api.setLab(false);
    await page.reload();
    await expect(
      page.getByText(
        'The reliability lab is available only in an enabled local development session.',
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'Reliability lab', exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole('button', {
        name: 'Run selected demonstration',
        exact: true,
      }),
    ).toHaveCount(0);
    expect(starts).toBe(1);
    expect((await api.counters()).reserved).toBe(0);
  });
});
