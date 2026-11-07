"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { authClient } from "@/lib/auth-client";
import { Button } from "./ui/button";
import { TextField } from "./ui/field";
import { PasswordField } from "./ui/password-field";
import { Alert } from "./ui/surface";

const SOCIAL_LABELS = { google: "Google", github: "GitHub" } as const;

/** Larger stage controls for the auth card. */
const INPUT = "h-14 rounded-xl border-glass-line bg-[rgb(4_9_20/0.7)] px-4 text-base focus:border-primary focus:shadow-[0_0_0_3px_rgb(0_216_255/0.14),0_0_24px_-6px_var(--glow-cyan)]";

function ProviderLogo({ provider }: { provider: keyof typeof SOCIAL_LABELS }) {
  if (provider === "github") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" className="size-6" fill="currentColor">
        <path d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.52-1.33-1.28-1.69-1.28-1.69-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.19 1.76 1.19 1.03 1.76 2.69 1.25 3.35.96.1-.75.4-1.25.73-1.54-2.56-.29-5.25-1.28-5.25-5.69 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.84 1.19 3.1 0 4.42-2.7 5.39-5.27 5.68.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5Z" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="size-6">
      <path fill="#4285F4" d="M23.5 12.27c0-.85-.08-1.67-.22-2.45H12v4.64h6.45a5.5 5.5 0 0 1-2.39 3.62v3h3.87c2.26-2.09 3.57-5.16 3.57-8.81Z" />
      <path fill="#34A853" d="M12 24c3.24 0 5.96-1.07 7.93-2.92l-3.87-3c-1.07.72-2.45 1.15-4.06 1.15-3.12 0-5.77-2.11-6.71-4.95h-4v3.1A12 12 0 0 0 12 24Z" />
      <path fill="#FBBC05" d="M5.29 14.28a7.2 7.2 0 0 1 0-4.56v-3.1h-4a12 12 0 0 0 0 10.76l4-3.1Z" />
      <path fill="#EA4335" d="M12 4.77c1.76 0 3.34.61 4.59 1.8l3.43-3.43A11.5 11.5 0 0 0 12 0 12 12 0 0 0 1.29 6.62l4 3.1C6.23 6.88 8.88 4.77 12 4.77Z" />
    </svg>
  );
}

export function AuthForm({ mode, socialProviders }: { mode: "sign-in" | "sign-up"; socialProviders: Array<keyof typeof SOCIAL_LABELS> }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const t = useTranslations("auth");

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email"));
    const password = String(form.get("password"));
    setPending(true);
    setError(null);
    const result =
      mode === "sign-up"
        ? await authClient.signUp.email({ email, password, name: String(form.get("name")) })
        : await authClient.signIn.email({ email, password });
    setPending(false);
    if (result.error) {
      setError(result.error.message ?? t("failed"));
      return;
    }
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <div>
      <div className="text-center">
        <h1 className="font-[family-name:var(--font-display)] text-[clamp(30px,3vw,42px)] leading-tight font-semibold tracking-[-0.02em]">
          {mode === "sign-up" ? t("signUpTitle") : t("signInTitle")}
        </h1>
        <p className="mt-2 text-base text-muted sm:text-lg">{mode === "sign-up" ? t("signUpText") : t("signInText")}</p>
      </div>
      <form onSubmit={onSubmit} className="mt-8 space-y-5">
        {mode === "sign-up" ? <TextField label={t("name")} name="name" autoComplete="name" required minLength={2} className={INPUT} /> : null}
        <TextField label={t("email")} name="email" type="email" autoComplete="email" required className={INPUT} />
        <PasswordField
          label={t("password")}
          name="password"
          className={INPUT}
          autoComplete={mode === "sign-up" ? "new-password" : "current-password"}
          required
          minLength={12}
          hint={mode === "sign-up" ? t("passwordHint") : undefined}
        />
        {error ? <Alert>{error}</Alert> : null}
        <Button
          type="submit"
          disabled={pending}
          className="mt-2 h-14 w-full rounded-xl bg-[linear-gradient(90deg,#1cc8ff,#5ef0c8)] text-base font-semibold text-[#03121c] shadow-[0_0_32px_-8px_rgb(34_211_238/0.7)] hover:brightness-110"
        >
          {pending ? t("pleaseWait") : mode === "sign-up" ? t("createAccount") : t("signIn")}
        </Button>
      </form>
      {socialProviders.length > 0 ? (
        <div className="mt-6 space-y-3">
          <p className="flex items-center gap-4 text-sm text-muted">
            <span aria-hidden="true" className="h-px flex-1 bg-glass-line" />
            {t("orContinue")}
            <span aria-hidden="true" className="h-px flex-1 bg-glass-line" />
          </p>
          {socialProviders.map((provider) => (
            <Button
              key={provider}
              variant="secondary"
              className="h-14 w-full gap-3 rounded-xl border-white/20 bg-transparent text-base font-semibold hover:border-primary hover:bg-white/5"
              onClick={async () => {
                setError(null);
                const result = await authClient.signIn.social({ provider, callbackURL: "/dashboard" });
                if (result.error) setError(result.error.message ?? t("socialFailed"));
              }}
            >
              <ProviderLogo provider={provider} />
              <span>
                <span className="sr-only">{t("continueWith")} </span>
                {SOCIAL_LABELS[provider]}
              </span>
            </Button>
          ))}
        </div>
      ) : null}
      {mode === "sign-up" ? (
        <p className="mt-6 text-center text-sm text-muted">
          {t.rich("acceptTerms", {
            terms: (chunks) => (
              <Link className="underline hover:text-text" href="/agb">
                {chunks}
              </Link>
            ),
            privacy: (chunks) => (
              <Link className="underline hover:text-text" href="/datenschutz">
                {chunks}
              </Link>
            ),
          })}
        </p>
      ) : null}
      <p className="mt-8 text-center text-base text-muted">
        {mode === "sign-up" ? (
          <>
            {t("haveAccount")} <Link className="font-semibold text-primary hover:underline" href="/sign-in">{t("signIn")}</Link>
          </>
        ) : (
          <>
            {t("newHere")} <Link className="font-semibold text-primary hover:underline" href="/sign-up">{t("createAnAccount")}</Link>
          </>
        )}
      </p>
    </div>
  );
}
