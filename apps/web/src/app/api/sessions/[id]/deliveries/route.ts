import { listDeliveries } from "@consyrion/db";
import { reportLocale } from "@consyrion/council";
import { cookies, headers } from "next/headers";
import { NextResponse } from "next/server";
import { isLocale, LOCALE_COOKIE, localeFromAcceptLanguage } from "@/i18n/locales";
import { requireActor } from "@/lib/server/actor";
import { handle, readJson } from "@/lib/server/api";
import { getDb } from "@/lib/server/db";
import { deliverDecision, type DeliverInput } from "@/lib/server/delivery";
import { getKeyring } from "@/lib/server/keyring";
import { rateLimit } from "@/lib/server/rate-limit";

type Params = { params: Promise<{ id: string }> };

/** Where this decision was sent, with status and reason of failures (#165). */
export const GET = handle(async (_request: Request, { params }: Params) => {
  const actor = await requireActor();
  return NextResponse.json({ deliveries: await listDeliveries(await getDb(), actor, (await params).id) });
});

/** "Send to …": e-mail to workspace members, Telegram or Confluence. A failed send is a logged result (200). */
export const POST = handle(async (request: Request, { params }: Params) => {
  const actor = await requireActor();
  rateLimit(`deliver:${actor.userId}`, 20, 60_000);
  // Confluence test 09.11.26: the page came out in English from a German interface – the sender's language now counts.
  const chosen = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = reportLocale(isLocale(chosen) ? chosen : localeFromAcceptLanguage((await headers()).get("accept-language")));
  const result = await deliverDecision(await getDb(), actor, getKeyring(), (await params).id, (await readJson(request)) as DeliverInput, { locale });
  return NextResponse.json(result);
});
