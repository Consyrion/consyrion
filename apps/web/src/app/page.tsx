import { LandingPage } from "@/components/landing/landing-page";
import { getSessionUser } from "@/lib/server/actor";

export const metadata = {
  title: { absolute: "CONSYRION AI – Debate. Decide. Deliver." },
  description:
    "Several AI models think independently, challenge each other and reach a documented verdict. You approve – then CONSYRION AI builds it as a reviewed pull request.",
};

/** Public home (consyrion.com). Signed-in users see "Open dashboard" instead of "Sign in". */
export default async function Home() {
  return <LandingPage signedIn={Boolean(await getSessionUser())} />;
}
