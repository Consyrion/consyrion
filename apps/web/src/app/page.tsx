import { LandingPage } from "@/components/landing/landing-page";
import { getSessionUser } from "@/lib/server/actor";
import { getTranslations } from "next-intl/server";

/** QA 12.11.26: the German page carried an English title and description – both follow the page language now. */
export async function generateMetadata() {
  const t = await getTranslations("meta");
  return { title: { absolute: t("homeTitle") }, description: t("homeDescription") };
}

/** Public home (consyrium.com). Signed-in users see "Open dashboard" instead of "Sign in". */
export default async function Home() {
  return <LandingPage signedIn={Boolean(await getSessionUser())} />;
}
