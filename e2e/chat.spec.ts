// Sends a keyboard message, observes an intermediate streamed state and verifies reload persistence.
import { expect, test } from '@playwright/test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

test('scripted answer streams and persists across reload at 360 px', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (entry) => { if (entry.type() === 'error') errors.push(entry.text()); });
  await page.goto('/');
  await expect(page.getByText('FAKE PROVIDERS:', { exact: false })).toBeVisible();
  const input = page.getByRole('textbox', { name: 'Message' });
  await input.fill('hello');
  await input.press('Enter');
  await expect(page.getByRole('button', { name: 'Stop' })).toBeVisible();
  await expect(page.locator('.assistant')).toContainText('Scripted response.');
  await expect(page.locator('.assistant')).toContainText('You wrote: hello');
  await expect(page.getByRole('button', { name: 'Stop' })).toHaveCount(0);
  await expect(input).toBeFocused();
  await page.reload();
  await expect(page.locator('.assistant')).toContainText('You wrote: hello');
  await expect(page.getByText('FAKE PROVIDERS:', { exact: false })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(360);
  const dir = process.env.CONTINUUM_E2E_DATA_DIR;
  if (dir) {
    expect(existsSync(join(dir, 'continuum-fake.db'))).toBe(true);
    expect(existsSync(join(dir, 'continuum.db'))).toBe(false);
  }
  expect(errors).toEqual([]);
});
