import { test as base, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { browserFixture, password, learner, workshopId } from './harness.js';
import type { BrowserFixture } from './harness.js';

export const test = base.extend<{
  api: BrowserFixture;
  labEnabled: boolean;
  releaseMode: boolean;
}>({
  labEnabled: [false, { option: true }],
  releaseMode: [false, { option: true }],
  api: [
    async ({ labEnabled, releaseMode }, use) => {
      const fixture = await browserFixture(labEnabled, releaseMode);
      try {
        await use(fixture);
      } finally {
        await fixture.close();
      }
    },
    { timeout: 45000 },
  ],
  page: async ({ page, api }, use) => {
    void api;
    try {
      await use(page);
    } finally {
      await page.close();
    }
  },
});
export { expect };
test.afterEach(async ({ page }, info) => {
  if (info.status !== info.expectedStatus && !page.isClosed())
    await page.screenshot({
      path: info.outputPath('failure.png'),
      mask: [page.locator('input[type="password"]')],
      animations: 'disabled',
    });
});

export async function login(page: Page, email = learner) {
  if (page.url() === 'about:blank') await page.goto('/login');
  else if (new URL(page.url()).pathname !== '/login')
    await page
      .getByRole('navigation')
      .getByRole('link', { name: 'Sign in', exact: true })
      .click();
  await expect(
    page.getByRole('button', { name: 'Sign in', exact: true }),
  ).toBeEnabled();
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/workshops$/);
  await expect(
    page.getByRole('button', { name: 'Sign out', exact: true }),
  ).toBeVisible();
}
export async function details(page: Page) {
  if (new URL(page.url()).pathname !== '/workshops/' + workshopId) {
    await page
      .getByRole('navigation')
      .getByRole('link', { name: 'Workshops', exact: true })
      .click();
    await page
      .getByRole('link', {
        name: 'View details for Synthetic browser workshop',
        exact: true,
      })
      .click();
  }
  await expect(
    page.getByRole('heading', {
      name: 'Synthetic browser workshop',
      exact: true,
    }),
  ).toBeVisible();
}
export async function reserve(page: Page) {
  await details(page);
  await page
    .getByRole('button', { name: 'Reserve one seat', exact: true })
    .click();
  await expect(
    page.getByText('Your seat is reserved.', { exact: true }),
  ).toBeVisible();
}
export async function confirmCancel(page: Page) {
  await page
    .getByRole('button', { name: 'Cancel booking', exact: true })
    .click();
  const dialog = page.getByRole('alertdialog', {
    name: 'Cancel your booking?',
    exact: true,
  });
  await expect(
    dialog.getByRole('button', { name: 'Keep booking', exact: true }),
  ).toBeFocused();
  await dialog
    .getByRole('button', { name: 'Cancel booking', exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
}
export async function noOverflow(page: Page) {
  const fits = await page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth,
  );
  expect(fits).toBe(true);
}
