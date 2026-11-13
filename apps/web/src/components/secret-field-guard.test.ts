import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * QA 12.11.26: Chrome filled a saved login (e-mail + password) into "Add API key" – one click on "Save key" would have
 * sent the user's password to the server and on to the provider as a key check. Every secret input that is not a sign-in
 * password (API keys, bot tokens, Stripe keys) must tell browsers and password managers to stay out.
 */
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : /\.tsx$/.test(name) && !/\.test\./.test(name) ? [path] : [];
  });
}

/** Sign-in, sign-up and password reset legitimately use the browser's password autofill. */
const AUTH_FILES = ["auth-form.tsx", "password-reset-form.tsx", "password-field.tsx", "field.tsx"];

describe("Secret fields", () => {
  it("never invite password autofill outside sign-in", () => {
    const offenders: string[] = [];
    for (const file of files(join(__dirname, ".."))) {
      if (AUTH_FILES.some((name) => file.endsWith(name)) || file.includes(join("app", "(auth)"))) continue;
      const source = readFileSync(file, "utf8");
      // Each JSX element that renders a password input – directly or through PasswordField.
      // These inputs are self-closing; "/>" ends the element even when a handler contains "=>".
      const elements = source.match(/<(?:TextField|input|PasswordField)\b[\s\S]*?\/>/g) ?? [];
      for (const element of elements) {
        if (!/type="password"/.test(element) && !element.startsWith("<PasswordField")) continue;
        if (!/autoComplete="new-password"/.test(element) || !/data-1p-ignore/.test(element)) offenders.push(`${file}: ${element.slice(0, 80)}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
