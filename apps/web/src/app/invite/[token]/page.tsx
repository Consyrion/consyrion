import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { AuthShell } from "@/components/auth-shell";
import { AcceptInvitation } from "@/components/saas";
import { getSessionUser } from "@/lib/server/actor";

export async function generateMetadata() {
  const t = await getTranslations("auth.invite");
  return { title: t("metaTitle") };
}

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const user = await getSessionUser();
  const t = await getTranslations("auth.invite");
  return (
    <AuthShell>
      <h1 className="font-[family-name:var(--font-display)] text-2xl font-semibold">{t("title")}</h1>
      {user ? (
        <>
          <p className="mt-2 mb-4 text-sm text-muted">{t("signedInAs", { email: user.email })}</p>
          <AcceptInvitation token={token} />
        </>
      ) : (
        <p className="mt-2 text-sm text-muted">
          {t.rich("signedOut", {
            signIn: (chunks) => (
              <Link className="text-primary underline" href="/sign-in">
                {chunks}
              </Link>
            ),
            signUp: (chunks) => (
              <Link className="text-primary underline" href="/sign-up">
                {chunks}
              </Link>
            ),
          })}
        </p>
      )}
    </AuthShell>
  );
}
