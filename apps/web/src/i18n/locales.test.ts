import { describe, expect, it } from "vitest";
import { LEGACY_LOCALE_COOKIE, LOCALE_COOKIE, localeCookie } from "./locales";

const jar = (values: Record<string, string>) => ({ get: (name: string) => (name in values ? { value: values[name]! } : undefined) });

describe("language cookie across the rename", () => {
  it("reads the new cookie first and falls back to the former name", () => {
    expect(LOCALE_COOKIE).toBe("consyrium-locale");
    expect(localeCookie(jar({ [LOCALE_COOKIE]: "fr", [LEGACY_LOCALE_COOKIE]: "de" }))).toBe("fr");
    expect(localeCookie(jar({ [LEGACY_LOCALE_COOKIE]: "de" }))).toBe("de");
    expect(localeCookie(jar({}))).toBeUndefined();
  });
});
