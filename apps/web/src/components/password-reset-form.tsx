"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { authClient } from "@/lib/auth-client";
import { Button } from "./ui/button";
import { TextField } from "./ui/field";
import { PasswordField } from "./ui/password-field";
import { Alert } from "./ui/surface";

const INPUT =
  "h-14 rounded-xl border-glass-line bg-[rgb(4_9_20/0.7)] px-4 text-base focus:border-primary focus:shadow-[0_0_0_3px_rgb(0_216_255/0.14),0_0_24px_-6px_var(--glow-cyan)]";
const SUBMIT =
  "mt-2 h-14 w-full rounded-xl bg-[linear-gradient(90deg,#1cc8ff,#5ef0c8)] text-base font-semibold text-[#03121c] shadow-[0_0_32px_-8px_rgb(34_211_238/0.7)] hover:brightness-110";

function Heading({ title, text }: { title: string; text: string }) {
  return (
    <div className="text-center">
      <h1 className="font-[family-name:var(--font-display)] text-[clamp(30px,3vw,42px)] leading-tight font-semibold tracking-[-0.02em]">{title}</h1>
      <p className="mt-2 text-base text-muted sm:text-lg">{text}</p>
    </div>
  );
}

function BackToSignIn() {
  const t = useTranslations("auth");
  return (
    <p className="mt-8 text-center text-base">
      <Link className="font-semibold text-primary hover:underline" href="/sign-in">
        {t("signIn")}
      </Link>
    </p>
  );
}

/**
 * Step 1 of the password reset (#395): asks for the address. The answer is the same whether or not an account exists,
 * so the form cannot be used to find out who has an account.
 */
export function RequestPasswordResetForm() {
  const t = useTranslations("auth");
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = String(new FormData(event.currentTarget).get("email"));
    setPending(true);
    setError(null);
    const result = await authClient.requestPasswordReset({ email, redirectTo: "/reset-password" });
    setPending(false);
    if (result.error) setError(result.error.message ?? t("failed"));
    else setSent(email);
  }

  return (
    <div>
      <Heading title={t("resetTitle")} text={t("resetRequestText")} />
      {sent ? (
        <div className="mt-8">
          <Alert tone="success">{t("resetSent", { email: sent })}</Alert>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="mt-8 space-y-5">
          <TextField label={t("email")} name="email" type="email" autoComplete="email" required className={INPUT} />
          {error ? <Alert>{error}</Alert> : null}
          <Button type="submit" disabled={pending} className={SUBMIT}>
            {pending ? t("pleaseWait") : t("resetSend")}
          </Button>
        </form>
      )}
      <BackToSignIn />
    </div>
  );
}

/** Step 2: the link from the e-mail leads here with `?token=…` (or `?error=INVALID_TOKEN` when it expired). */
export function ResetPasswordForm({ token, invalid }: { token: string | null; invalid: boolean }) {
  const t = useTranslations("auth");
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (invalid || !token) {
    return (
      <div>
        <Heading title={t("resetInvalidTitle")} text={t("resetInvalidText")} />
        <p className="mt-8 text-center text-base">
          <Link className="font-semibold text-primary hover:underline" href="/forgot-password">
            {t("resetRequestAgain")}
          </Link>
        </p>
      </div>
    );
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password"));
    if (password !== String(form.get("confirm"))) {
      setError(t("resetMismatch"));
      return;
    }
    setPending(true);
    setError(null);
    const result = await authClient.resetPassword({ newPassword: password, token: token! });
    setPending(false);
    if (result.error) setError(result.error.code === "INVALID_TOKEN" ? t("resetInvalidText") : (result.error.message ?? t("failed")));
    else setDone(true);
  }

  return (
    <div>
      <Heading title={t("resetTitle")} text={done ? t("resetDone") : t("resetNewText")} />
      {done ? null : (
        <form onSubmit={onSubmit} className="mt-8 space-y-5">
          <PasswordField label={t("resetNewPassword")} name="password" className={INPUT} autoComplete="new-password" required minLength={12} hint={t("passwordHint")} />
          <PasswordField label={t("resetConfirm")} name="confirm" className={INPUT} autoComplete="new-password" required minLength={12} />
          {error ? <Alert>{error}</Alert> : null}
          <Button type="submit" disabled={pending} className={SUBMIT}>
            {pending ? t("pleaseWait") : t("resetSave")}
          </Button>
        </form>
      )}
      <BackToSignIn />
    </div>
  );
}
