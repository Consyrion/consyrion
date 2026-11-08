import { getTranslations } from "next-intl/server";
import { DangerDelete } from "../saas";
import { buttonClasses } from "../ui/button";
import { Card } from "../ui/surface";

/**
 * #198 (owner decision 08.11.26): delete this whole council session – never a single verdict, no archive. The report
 * export is offered first; a running council or an active build must be stopped before (the server refuses otherwise).
 */
export async function SessionDelete({ sessionId, projectName, running }: { sessionId: string; projectName: string; running: boolean }) {
  const t = await getTranslations("sessionDelete");
  return (
    <Card className="mt-6 border-danger/40" data-testid="session-delete">
      <h2 className="font-semibold text-danger">{t("title")}</h2>
      <p className="mt-1 text-sm text-muted">{t("text")}</p>
      <p className="mt-2 text-sm">{t("exportFirst")}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <a className={buttonClasses("secondary")} href={`/api/sessions/${sessionId}/report?format=pdf&level=full`}>
          {t("exportPdf")}
        </a>
        <a className={buttonClasses("secondary")} href={`/api/sessions/${sessionId}/report`}>
          {t("exportMarkdown")}
        </a>
      </div>
      {running ? <p className="mt-3 text-sm text-warning">{t("stopFirst")}</p> : null}
      <p className="mt-3 text-xs text-muted">{t("external")}</p>
      <div className="mt-3">
        <DangerDelete url={`/api/sessions/${sessionId}`} method="DELETE" name={projectName} label={t("button")} redirectTo="/decisions" />
      </div>
    </Card>
  );
}
