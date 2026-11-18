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

test('research shows actual search progress and inspectable sources after reload', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('FAKE PROVIDERS:', { exact: false })).toBeVisible();
  const input = page.getByRole('textbox', { name: 'Message' });
  await input.fill('What is the latest Continuum news?');
  await input.press('Enter');
  await expect(page.getByRole('list', { name: 'Search progress' })).toContainText('Searching');
  await expect(page.getByRole('button', { name: 'Stop' })).toHaveCount(0);
  const answer = page.locator('.assistant');
  await expect(answer).toContainText('scripted research demo');
  await expect(answer).not.toContainText('Unverified preliminary');
  const source = page.getByText('Scripted research source', { exact: false });
  await expect(source).toContainText('example.com');
  await source.click();
  await expect(page.getByText('Retrieved', { exact: false })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open source' })).toHaveAttribute('href', 'https://example.com/qualification');
  await page.reload();
  await expect(answer).toContainText('scripted research demo');
  await expect(source).toBeVisible();
});

test('cross-conversation memory offers persistent clarification choices and opens the selected provenance', async ({ page }) => {
  await page.goto('/');
  const input = page.getByRole('textbox', { name: 'Message' });
  const submit = async (text: string) => {
    await input.fill(text);
    await input.press('Enter');
  };
  for (const topic of ['Explain ceramic glazing', 'Explain ceramic firing']) {
    await submit(topic);
    await expect(page.locator('.assistant')).toContainText('scripted explanation');
    await page.getByRole('button', { name: 'New chat' }).click();
  }
  await submit('Is the ceramic answer still correct?');
  await expect(page.getByRole('group', { name: 'Clarification choices' })).toBeVisible();
  await page.reload();
  await page.getByRole('group', { name: 'Clarification choices' }).getByRole('button', { name: 'Explain ceramic glazing' }).click();
  await expect(page.getByRole('group', { name: 'Clarification choices' })).toHaveCount(0);
  const provenance = page.getByRole('region', { name: 'Past conversations' });
  await expect(provenance).toContainText('Explain ceramic glazing');
  await expect(provenance).toContainText('fake');
  await provenance.getByRole('button', { name: 'Open Explain ceramic glazing' }).click();
  await expect(page.locator('.message.user')).toContainText('Explain ceramic glazing');
});
