import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { ResetPasswordForm } from "@/components/password-reset-form";
import { passwordResetEnabled } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("auth");
  return { title: t("resetTitle") };
}

/** Target of the reset link (#395): Better Auth checks the token and redirects here with `?token=…` or `?error=…`. */
export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string; error?: string }> }) {
  if (!passwordResetEnabled) notFound();
  const { token, error } = await searchParams;
  return <ResetPasswordForm token={token ?? null} invalid={Boolean(error)} />;
}
