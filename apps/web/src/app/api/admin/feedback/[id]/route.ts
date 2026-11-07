import { deleteFeedback, getFeedbackForAdmin, setFeedbackState, type FeedbackState } from "@consyrion/db";
import { NextResponse } from "next/server";
import { requirePlatformAdminContext } from "@/lib/server/admin";
import { handle, readJson } from "@/lib/server/api";
import { getDb } from "@/lib/server/db";

type Params = { params: Promise<{ id: string }> };

/** One report with every attached detail and the replies (platform admin only, #295). */
export const GET = handle(async (_request: Request, { params }: Params) => {
  const admin = await requirePlatformAdminContext();
  return NextResponse.json(await getFeedbackForAdmin(await getDb(), admin, (await params).id));
});

/** Body { state: "new" | "in_progress" | "done" }. */
export const PATCH = handle(async (request: Request, { params }: Params) => {
  const admin = await requirePlatformAdminContext();
  const body = (await readJson(request)) as { state?: unknown };
  const report = await setFeedbackState(await getDb(), admin, (await params).id, String(body.state ?? "") as FeedbackState);
  return NextResponse.json({ id: report.id, state: report.state, doneAt: report.doneAt });
});

/** Deletes the report and its replies for good (also used for deletion requests of the author). */
export const DELETE = handle(async (_request: Request, { params }: Params) => {
  const admin = await requirePlatformAdminContext();
  await deleteFeedback(await getDb(), admin, (await params).id);
  return new NextResponse(null, { status: 204 });
});
