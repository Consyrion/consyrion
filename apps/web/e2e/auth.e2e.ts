import { expect, test, type Page } from "@playwright/test";

/**
 * Auth regression tests (live bug 08.11.26: a successful e-mail sign-in landed on "address confirmed – sign in" for
 * 24 hours). Every flow runs in the real browser against the production build, with e-mail verification on (SMTP set),
 * so the client-side redirects of Better Auth are part of the test.
 */

const MAIL = `http://127.0.0.1:${process.env.E2E_SMTP_HTTP_PORT ?? 2526}`;
const run = Date.now().toString(36);
const PASSWORD = "e2e-Password-123456";
const ana = { name: "Ana E2E", email: `ana-${run}@e2e.test` };
const ben = { name: "Ben E2E", email: `ben-${run}@e2e.test` };

/** The newest link from a mail to `email` that contains `part`; waits until the mail has arrived. */
async function linkFromMail(email: string, part: string, after = 0): Promise<string> {
  let link: string | undefined;
  await expect
    .poll(
      async () => {
        const messages: Array<{ text: string; at: number }> = await (await fetch(`${MAIL}/?to=${encodeURIComponent(email)}`)).json();
        link = messages
          .filter((m) => m.at >= after)
          .flatMap((m) => m.text.match(/https?:\/\/\S+/g) ?? [])
          .filter((url) => url.includes(part))
          .at(-1);
        return link;
      },
      { timeout: 20_000 },
    )
    .toBeTruthy();
  return link!;
}

async function signUp(page: Page, who: { name: string; email: string }) {
  await page.goto("/sign-up");
  await page.locator('input[name="name"]').fill(who.name);
  await page.locator('input[name="email"]').fill(who.email);
  await page.locator('input[name="password"]').fill(PASSWORD);
  await page.locator('button[type="submit"]').click();
  await expect(page.getByText(/we sent a confirmation link/i)).toBeVisible();
}

async function signIn(page: Page, email: string, password = PASSWORD) {
  await page.goto("/sign-in");
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.locator('button[type="submit"]').click();
}

async function verify(page: Page, email: string) {
  await page.goto(await linkFromMail(email, "verify-email"));
  await expect(page).toHaveURL(/\/verify-email(\?|$)/);
  await expect(page.getByRole("heading", { name: "E-mail address confirmed" })).toBeVisible();
}

/** A signed-in browser lands on the dashboard and stays there (no hop to /verify-email or /sign-in). */
async function expectDashboard(page: Page, who: { name: string }) {
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 20_000 });
  await expect(page.getByText(who.name).first()).toBeVisible();
  await page.waitForTimeout(1_000);
  await expect(page).toHaveURL(/\/dashboard$/);
}

async function expectSignedOut(page: Page) {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/sign-in$/);
}

test.describe.configure({ mode: "serial" });

// Better Auth limits sign-ins to 3 per 10 s and client IP in production. Behind the proxy the IP comes from
// X-Forwarded-For; each test gets its own address, so the limit stays on without the tests waiting for it.
let client = 0;
test.beforeEach(async ({ page }) => {
  client += 1;
  await page.context().setExtraHTTPHeaders({ "x-forwarded-for": `198.51.100.${client}` });
});

test("sign-up opens no session; an unverified sign-in sends a fresh link", async ({ page }) => {
  await signUp(page, ana);
  await expectSignedOut(page);
  const before = Date.now();
  await signIn(page, ana.email);
  await expect(page.getByText(/confirm your e-mail address first/i)).toBeVisible();
  await expect(page).toHaveURL(/\/sign-in$/);
  expect(await linkFromMail(ana.email, "verify-email", before)).toContain("token=");
});

test("the verification link confirms the address but opens no session", async ({ page }) => {
  await verify(page, ana.email);
  await expectSignedOut(page);
});

test("a verified e-mail sign-in lands on the dashboard (regression 08.11.26)", async ({ page }) => {
  await signIn(page, ana.email);
  await expectDashboard(page, ana);
  await page.reload();
  await expectDashboard(page, ana);
});

test("a wrong password stays on the sign-in page without a session", async ({ page }) => {
  await signIn(page, ana.email, "wrong-Password-123456");
  await expect(page.getByText(/invalid email or password/i)).toBeVisible();
  await expect(page).toHaveURL(/\/sign-in$/);
  await expectSignedOut(page);
});

test("sign-out ends the session", async ({ page }) => {
  await signIn(page, ana.email);
  await expectDashboard(page, ana);
  await page.getByRole("button", { name: "Sign out" }).first().click();
  await expect(page).toHaveURL(/\/sign-in$/);
  await expectSignedOut(page);
});

test("signing in as another account replaces the existing session", async ({ page }) => {
  await signUp(page, ben);
  await verify(page, ben.email);
  await signIn(page, ana.email);
  await expectDashboard(page, ana);
  // Same browser, Ana still signed in: Ben signs in on the sign-in page and gets his own dashboard.
  await signIn(page, ben.email);
  await expectDashboard(page, ben);
  await expect(page.getByText(ana.name)).toHaveCount(0);
});

test("forgot password: the link sets a new password, the old one stops working", async ({ page }) => {
  const newPassword = "e2e-NewPassword-654321";
  const before = Date.now();
  await page.goto("/forgot-password");
  await page.locator('input[name="email"]').fill(ana.email);
  await page.locator('button[type="submit"]').click();
  await expect(page.getByText(/the link is on its way/i)).toBeVisible();

  await page.goto(await linkFromMail(ana.email, "reset-password", before));
  await expect(page).toHaveURL(/\/reset-password/);
  await page.locator('input[name="password"]').fill(newPassword);
  await page.locator('input[name="confirm"]').fill(newPassword);
  await page.locator('button[type="submit"]').click();
  await expect(page.getByText(/your password has been changed/i)).toBeVisible();

  await signIn(page, ana.email);
  await expect(page).toHaveURL(/\/sign-in$/);
  await signIn(page, ana.email, newPassword);
  await expectDashboard(page, ana);
});
