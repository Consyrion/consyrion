import { DomainError } from "@consyrion/core";
import {
  FEEDBACK_KINDS,
  FEEDBACK_STATES,
  countNewFeedback,
  getFeedbackForAdmin,
  listFeedbackForAdmin,
  type FeedbackKind,
  type FeedbackState,
} from "@consyrion/db";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { AdminFeedbackActions, FeedbackFilters } from "@/components/feedback";
import { Badge, Card, PageHeader } from "@/components/ui/surface";
import { requirePlatformAdminContext } from "@/lib/server/admin";
import { getDb } from "@/lib/server/db";

export async function generateMetadata() {
  const t = await getTranslations("feedback.admin");
  return { title: t("title") };
}

const STATE_TONE = { new: "primary", in_progress: "warning", done: "success" } as const;

type Search = { kind?: string; state?: string; id?: string };

/** Feedback inbox of the platform admins (#295): filter, details, status, reply, delete. Hidden (404) for everybody else. */
export default async function AdminFeedbackPage({ searchParams }: { searchParams: Promise<Search> }) {
  const admin = await requirePlatformAdminContext().catch((error: unknown) => {
    if (error instanceof DomainError) notFound();
    throw error;
  });
  const search = await searchParams;
  const kind = (FEEDBACK_KINDS as readonly string[]).includes(search.kind ?? "") ? (search.kind as FeedbackKind) : null;
  const state = (FEEDBACK_STATES as readonly string[]).includes(search.state ?? "") ? (search.state as FeedbackState) : null;
  const t = await getTranslations("feedback");
  const format = await getFormatter();
  const db = await getDb();
  const [reports, newCount] = await Promise.all([listFeedbackForAdmin(db, admin, { kind, state }), countNewFeedback(db, admin)]);
  const detail = search.id ? await getFeedbackForAdmin(db, admin, search.id).catch(() => null) : null;

  const query = (extra: Record<string, string | null>) => {
    const params = new URLSearchParams();
    if (kind) params.set("kind", kind);
    if (state) params.set("state", state);
    for (const [k, v] of Object.entries(extra)) if (v) params.set(k, v);
    return `/admin/feedback${params.size ? `?${params}` : ""}`;
  };
  const when = (d: Date) => format.dateTime(d, { dateStyle: "medium", timeStyle: "short" });

  return (
    <>
      <PageHeader
        title={t("admin.title")}
        description={t("admin.description")}
        actions={
          <Link href="/admin" className="text-sm text-muted underline hover:text-text">
            {t("admin.back")}
          </Link>
        }
      />
      <p className="mb-4 text-sm">
        <Badge tone={newCount ? "primary" : "neutral"}>{t("admin.newCount", { count: newCount })}</Badge>
      </p>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <Card className={detail ? "hidden lg:block" : ""}>
          <FeedbackFilters kind={kind ?? ""} state={state ?? ""} />
          {reports.length === 0 ? (
            <p className="mt-4 text-sm text-muted">{t("admin.empty")}</p>
          ) : (
            <ul className="mt-4 divide-y divide-line">
              {reports.map((r) => (
                <li key={r.id}>
                  <Link
                    href={query({ id: r.id })}
                    aria-current={detail?.feedback.id === r.id ? "true" : undefined}
                    className="block space-y-1 rounded-lg px-2 py-3 hover:bg-surface-2/60 aria-[current=true]:bg-primary/10"
                  >
                    <span className="flex flex-wrap items-center gap-2">
                      <Badge>{t(`kinds.${r.kind}`)}</Badge>
                      <Badge tone={STATE_TONE[r.state]}>{t(`states.${r.state}`)}</Badge>
                      <span className="text-xs text-muted">{when(r.createdAt)}</span>
                    </span>
                    <span className="block font-medium break-words">{r.subject}</span>
                    <span className="block text-xs break-all text-muted">
                      {r.email} · {r.userId ? t("admin.user") : t("admin.visitor")}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card className={detail ? "" : "hidden lg:block"}>
          {detail ? (
            <div className="space-y-4">
              <Link href={query({})} className="text-sm text-muted underline hover:text-text lg:hidden">
                {t("admin.backToList")}
              </Link>
              <div className="flex flex-wrap items-center gap-2">
                <Badge>{t(`kinds.${detail.feedback.kind}`)}</Badge>
                <Badge tone={STATE_TONE[detail.feedback.state]}>{t(`states.${detail.feedback.state}`)}</Badge>
              </div>
              <h2 className="text-lg font-semibold break-words">{detail.feedback.subject}</h2>
              <p className="text-sm whitespace-pre-wrap break-words">{detail.feedback.text}</p>
              <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-sm">
                {(
                  [
                    [t("admin.from"), `${detail.feedback.email} (${detail.feedback.userId ? t("admin.user") : t("admin.visitor")})`],
                    [t("admin.received"), when(detail.feedback.createdAt)],
                    [t("admin.page"), detail.feedback.page],
                    [t("admin.locale"), detail.feedback.locale],
                    [t("admin.agent"), detail.feedback.agent],
                    [t("admin.version"), detail.feedback.appVersion],
                    [t("admin.workspace"), detail.feedback.organizationId],
                    [t("admin.doneAt"), detail.feedback.doneAt ? when(detail.feedback.doneAt) : null],
                  ] as const
                ).map(([label, value]) => (
                  <div key={label} className="contents">
                    <dt className="text-muted">{label}</dt>
                    <dd className="[overflow-wrap:anywhere]">{value || "–"}</dd>
                  </div>
                ))}
              </dl>
              <div>
                <h3 className="text-sm font-semibold">{t("admin.replies")}</h3>
                {detail.replies.length === 0 ? (
                  <p className="mt-1 text-sm text-muted">{t("admin.noReplies")}</p>
                ) : (
                  <ul className="mt-2 space-y-2">
                    {detail.replies.map((reply) => (
                      <li key={reply.id} className="rounded-xl border border-primary/30 bg-primary/5 p-3">
                        <p className="text-xs text-primary">{when(reply.createdAt)}</p>
                        <p className="mt-1 text-sm whitespace-pre-wrap break-words">{reply.text}</p>
                      </li>
                    ))}
                  </ul>
                )}
                {!detail.feedback.userId ? <p className="mt-2 text-xs text-muted">{t("admin.visitorReplyNote")}</p> : null}
              </div>
              <AdminFeedbackActions id={detail.feedback.id} state={detail.feedback.state} listHref={query({})} />
            </div>
          ) : (
            <p className="text-sm text-muted">{search.id ? t("admin.notFound") : t("admin.select")}</p>
          )}
        </Card>
      </div>
    </>
  );
}
