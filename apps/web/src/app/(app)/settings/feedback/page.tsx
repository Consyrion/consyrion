import { listMyFeedback } from "@consyrion/db";
import { getFormatter, getTranslations } from "next-intl/server";
import { FeedbackForm } from "@/components/feedback";
import { Badge, Card, PageHeader } from "@/components/ui/surface";
import { requirePageActor } from "@/lib/server/actor";
import { getDb } from "@/lib/server/db";

export async function generateMetadata() {
  const t = await getTranslations("feedback");
  return { title: t("metaTitle") };
}

const STATE_TONE = { new: "primary", in_progress: "warning", done: "success" } as const;

/** Send feedback and read the answers ("My reports", #295). `?from=` is the app page the user came from. */
export default async function FeedbackSettingsPage({ searchParams }: { searchParams: Promise<{ from?: string }> }) {
  const actor = await requirePageActor();
  const { from } = await searchParams;
  const t = await getTranslations("feedback");
  const format = await getFormatter();
  const reports = await listMyFeedback(await getDb(), actor);
  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card>
          <h2 className="mb-4 font-semibold">{t("newTitle")}</h2>
          <FeedbackForm from={typeof from === "string" ? from : null} />
        </Card>
        <Card>
          <h2 className="font-semibold">{t("mine.title")}</h2>
          {reports.length === 0 ? (
            <p className="mt-2 text-sm text-muted">{t("mine.empty")}</p>
          ) : (
            <ul className="mt-3 divide-y divide-line">
              {reports.map((r) => (
                <li key={r.id} className="space-y-2 py-4 first:pt-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge>{t(`kinds.${r.kind}`)}</Badge>
                    <Badge tone={STATE_TONE[r.state]}>{t(`states.${r.state}`)}</Badge>
                    <span className="text-xs text-muted">{format.dateTime(r.createdAt, { dateStyle: "medium", timeStyle: "short" })}</span>
                  </div>
                  <p className="font-medium break-words">{r.subject}</p>
                  <p className="text-sm whitespace-pre-wrap break-words text-muted">{r.text}</p>
                  {r.replies.map((reply) => (
                    <div key={reply.id} className="rounded-xl border border-primary/30 bg-primary/5 p-3">
                      <p className="text-xs text-primary">
                        {t("mine.reply")} · {format.dateTime(reply.createdAt, { dateStyle: "medium", timeStyle: "short" })}
                      </p>
                      <p className="mt-1 text-sm whitespace-pre-wrap break-words">{reply.text}</p>
                    </div>
                  ))}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-4 text-xs text-muted">{t("mine.deleteNote")}</p>
        </Card>
      </div>
    </>
  );
}
