import Link from "next/link";
import { AuthShell } from "@/components/auth-shell";
import { AcceptInvitation } from "@/components/saas";
import { getSessionUser } from "@/lib/server/actor";

export const metadata = { title: "Invitation" };

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const user = await getSessionUser();
  return (
    <AuthShell>
      <h1 className="font-[family-name:var(--font-display)] text-2xl font-semibold">You were invited to a workspace</h1>
      {user ? (
        <>
          <p className="mt-2 mb-4 text-sm text-muted">Signed in as {user.email}. The invitation only works for the address it was sent to.</p>
          <AcceptInvitation token={token} />
        </>
      ) : (
        <p className="mt-2 text-sm text-muted">
          <Link className="text-primary underline" href="/sign-in">
            Sign in
          </Link>{" "}
          or{" "}
          <Link className="text-primary underline" href="/sign-up">
            create an account
          </Link>{" "}
          with the invited e-mail address, then open this link again.
        </p>
      )}
    </AuthShell>
  );
}
