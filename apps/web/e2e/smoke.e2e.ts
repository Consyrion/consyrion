import { expect, test } from "@playwright/test";

/**
 * Post-deploy smoke check: a real e-mail sign-in with a verified test account lands on /dashboard.
 * Credentials come only from the environment (SMOKE_EMAIL, SMOKE_PASSWORD) – never from the repository.
 * Run: SMOKE_BASE_URL=https://app.consyrion.com SMOKE_EMAIL=… SMOKE_PASSWORD=… pnpm --filter @consyrion/web e2e:smoke
 */
test("e-mail sign-in lands on the dashboard", async ({ page }) => {
  const email = process.env.SMOKE_EMAIL;
  const password = process.env.SMOKE_PASSWORD;
  test.skip(!email || !password, "SMOKE_EMAIL and SMOKE_PASSWORD are required");

  await page.goto("/sign-in");
  await page.locator('input[name="email"]').fill(email!);
  await page.locator('input[name="password"]').fill(password!);
  await page.locator('button[type="submit"]').click();
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 30_000 });
  await page.waitForTimeout(1_500);
  await expect(page).toHaveURL(/\/dashboard$/);

  // Leave no session behind on the server.
  await page.getByRole("button", { name: "Sign out" }).first().click();
  await expect(page).toHaveURL(/\/sign-in$/);
});
