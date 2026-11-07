"use client";

import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { LOCALE_COOKIE, LOCALE_LABELS, LOCALES, type Locale } from "@/i18n/locales";
import { Select } from "@/components/ui/select";

/** Interface language: stored in a cookie for a year; the page re-renders on the server in the new language. */
export function LanguageSwitcher({ className = "", align = "end" }: { className?: string; align?: "start" | "end" }) {
  const locale = useLocale() as Locale;
  const t = useTranslations("common");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <div className={`inline-flex items-center gap-1.5 text-xs text-muted ${className}`}>
      <span aria-hidden="true">🌐</span>
      <Select
        size="sm"
        align={align}
        aria-label={t("language")}
        value={locale}
        disabled={pending}
        onChange={(event) => {
          document.cookie = `${LOCALE_COOKIE}=${event.target.value}; path=/; max-age=31536000; samesite=lax`;
          startTransition(() => router.refresh());
        }}
      >
        {LOCALES.map((l) => (
          <option key={l} value={l}>
            {LOCALE_LABELS[l]}
          </option>
        ))}
      </Select>
    </div>
  );
}
