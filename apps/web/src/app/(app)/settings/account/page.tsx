import { SignInMethods } from "@/components/sign-in-methods";
import { PageHeader } from "@/components/ui/surface";
import { requirePageActor } from "@/lib/server/actor";
import { enabledSocialProviders } from "@/lib/server/auth";

export const metadata = { title: "Account" };

export default async function AccountPage() {
  await requirePageActor();
  return (
    <>
      <PageHeader title="Account" description="How you sign in. Connect several methods so they all open the same account and workspace." />
      <SignInMethods providers={enabledSocialProviders} />
    </>
  );
}
