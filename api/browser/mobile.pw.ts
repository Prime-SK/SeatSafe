import {
  test,
  expect,
  login,
  reserve,
  confirmCancel,
  noOverflow,
} from './fixtures.js';
import { administrator, learner } from './harness.js';

test('390px booking, safe cancellation focus and reduced-motion emulation', async ({
  page,
  api,
}, info) => {
  await login(page);
  await reserve(page);
  expect(page.viewportSize()?.width).toBe(390);
  expect(
    await page.evaluate(
      () => matchMedia('(prefers-reduced-motion: reduce)').matches,
    ),
  ).toBe(true);
  await noOverflow(page);
  const trigger = page
    .getByRole('button', {
      name: 'Cancel booking',
      exact: true,
    })
    .and(page.locator('app-cancel-booking > button'));
  await trigger.click();
  await expect(
    page
      .getByRole('alertdialog', { name: 'Cancel your booking?', exact: true })
      .getByRole('button', { name: 'Keep booking', exact: true }),
  ).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(
    page.getByRole('alertdialog', {
      name: 'Cancel your booking?',
      exact: true,
    }),
  ).not.toBeVisible();
  await expect(trigger).toBeFocused();
  const height = await trigger.evaluate(
    (element) => element.getBoundingClientRect().height,
  );
  expect(height).toBeGreaterThanOrEqual(44);
  expect(
    await trigger.evaluate(
      (element) => getComputedStyle(element).transitionDuration,
    ),
  ).toBe('0s');
  await confirmCancel(page);
  await expect(
    page.getByText('Your seat is reserved.', { exact: true }),
  ).toHaveCount(0);
  expect(await api.counters()).toEqual({ active: 0, reserved: 0, records: 1 });
  await noOverflow(page);
  await page.screenshot({
    path: info.outputPath('mobile-booking.png'),
    animations: 'disabled',
  });
});

test('390px administrator filters and safe disable confirmation', async ({
  page,
  api,
}, info) => {
  await login(page, administrator);
  await page.getByRole('link', { name: 'Manage users', exact: true }).click();
  await expect(
    page
      .getByText('Protected administrator', { exact: true })
      .filter({ visible: true }),
  ).toBeVisible();
  await page.getByLabel('Search name or email', { exact: true }).fill(learner);
  await page.getByLabel('Search name or email', { exact: true }).press('Enter');
  const trigger = page
    .getByRole('button', { name: 'Disable account: ' + learner, exact: true })
    .filter({ visible: true });
  await trigger.click();
  const dialog = page.getByRole('alertdialog', {
    name: 'Disable this account?',
    exact: true,
  });
  await expect(
    dialog.getByRole('button', { name: 'Keep enabled', exact: true }),
  ).toBeFocused();
  await noOverflow(page);
  await page.screenshot({
    path: info.outputPath('mobile-confirmation.png'),
    animations: 'disabled',
  });
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
  await trigger.click();
  await dialog
    .getByRole('button', { name: 'Disable account', exact: true })
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
    .toBe(false);
  await expect(
    page
      .getByRole('button', { name: 'Enable account: ' + learner, exact: true })
      .filter({ visible: true }),
  ).toBeVisible();
  await noOverflow(page);
});
