import { acceptInvitation } from "@consyrion/db";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ACTIVE_ORG_COOKIE, requireUser } from "@/lib/server/actor";
import { handle, readJson } from "@/lib/server/api";
import { getDb } from "@/lib/server/db";
import { emailVerificationEnabled } from "@/lib/server/email-verification";

export const POST = handle(async (request: Request) => {
  const user = await requireUser();
  const { token } = (await readJson(request)) as { token?: string };
  const org = await acceptInvitation(await getDb(), user.id, String(token ?? ""), { requireVerifiedEmail: emailVerificationEnabled() });
  (await cookies()).set(ACTIVE_ORG_COOKIE, org.id, { httpOnly: true, sameSite: "lax", path: "/", secure: process.env.NODE_ENV === "production" });
  return NextResponse.json({ organization: org });
});
