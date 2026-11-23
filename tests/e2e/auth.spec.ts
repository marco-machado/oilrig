import { type Page, expect, test } from '@playwright/test';

// Accounts end to end against the dev server: sign up, come aboard, leave, the same account
// in a second tab, sign out, sign back in. 5175 runs with sign-ups closed (the default).

const CLOSED = process.env.PW_CLOSED_URL ?? 'http://localhost:5175';
const stamp = Date.now().toString(36);
const username = `e2e-${stamp}`;
const displayName = `E2E ${stamp}`;
const password = 'ocean breeze 2026';

const loaded = (page: Page) => page.waitForFunction(() => (window as any).__oilrig?.stats.frames > 5, undefined, { timeout: 60_000 });
const joined = (page: Page) => page.evaluate(() => (window as any).__oilrig.ui.joined as boolean);

test('the sign-up page says sign-ups are closed when ALLOW_SIGNUPS is not "true"', async ({ page }) => {
  await page.goto(`${CLOSED}/signup`);
  await expect(page.locator('.oh-signup__card')).toContainText('Sign-ups are closed.');
  await page.goto(`${CLOSED}/?q=low`);
  await expect(page.locator('.oh-join__fields')).toBeVisible();
  await expect(page.locator('a:has-text("Create an account")')).toBeHidden();
});

test('sign up, come aboard, leave, lose the seat to a second tab, sign out and back in', async ({ page, context }) => {
  await page.goto('/signup');
  await page.fill('input[name=username]', username.toUpperCase());
  await page.fill('input[name=display-name]', displayName);
  await page.fill('input[name=password]', password);
  await page.fill('input[name=password-again]', 'not the same');
  await page.click('button:has-text("Create account")');
  await expect(page.locator('.oh-join__status')).toHaveText('The passwords do not match.');
  await page.fill('input[name=password-again]', password);
  await page.click('button:has-text("Create account")');
  await page.waitForURL((u) => u.pathname === '/');

  // Signed in: the start screen offers to come aboard.
  await page.goto('/?q=low');
  await loaded(page);
  await expect(page.locator('.oh-join__who')).toContainText(displayName);
  await page.click('button:has-text("Come aboard")');
  await expect.poll(() => joined(page), { timeout: 15_000 }).toBe(true);
  await expect(page.locator('.oh-chat__log')).toContainText(`Welcome aboard, ${displayName}.`);

  // Leave: back to the start screen, still signed in.
  await page.evaluate(() => document.exitPointerLock());
  await page.click('.oh-rail button:has-text("Leave")');
  await page.click('.oh-dialog button:has-text("Leave")');
  await expect(page.locator('.oh-join__status')).toHaveText('You left the platform.');
  await expect(page.locator('.oh-join__who')).toContainText(displayName);
  await page.click('button:has-text("Come aboard")');
  await expect.poll(() => joined(page), { timeout: 15_000 }).toBe(true);

  // The same account in a second tab takes over; the first is told and stays out.
  const second = await context.newPage();
  await second.goto('/?q=low');
  await loaded(second);
  await second.click('button:has-text("Come aboard")');
  await expect.poll(() => joined(second), { timeout: 15_000 }).toBe(true);
  await expect(page.locator('.oh-join__status')).toContainText('Signed in elsewhere', { timeout: 15_000 });
  expect(await joined(page)).toBe(false);
  await second.close();

  // Sign out, then sign back in with the username in any case.
  await page.click('.oh-join__links button:has-text("Sign out")');
  await expect(page.locator('.oh-join__fields')).toBeVisible();
  await page.fill('#oh-user', username);
  await page.fill('#oh-pass', 'wrong password');
  await page.click('button:has-text("Sign in")');
  await expect(page.locator('.oh-join__status')).toHaveText('Wrong username or password.');
  await page.fill('#oh-pass', password);
  await page.click('button:has-text("Sign in")');
  await expect.poll(() => joined(page), { timeout: 15_000 }).toBe(true);
});
