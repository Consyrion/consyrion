import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { RequestPasswordResetForm } from "@/components/password-reset-form";
import { passwordResetEnabled } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("auth");
  return { title: t("resetTitle") };
}

/** "Forgot password" (#395) – only offered when the server can send e-mail. */
export default function ForgotPasswordPage() {
  if (!passwordResetEnabled) notFound();
  return <RequestPasswordResetForm />;
}
