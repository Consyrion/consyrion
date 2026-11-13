"use client";

import { useTranslations } from "next-intl";
import { useActionState, useEffect } from "react";
import { Button, buttonClasses } from "@/components/ui/button";
import { Alert } from "@/components/ui/surface";
import { decideAuthorization, type ConsentState } from "./actions";

const INITIAL: ConsentState = { redirectTo: null, error: null };

/**
 * Allow / Deny of the consent page. The server action answers with the client's redirect URI; the browser goes there
 * by itself. App addresses (obsidian://, vscode://, …) leave this page open, so it then says that the tab can be
 * closed and keeps a link as a fallback for browsers that ask for a click before opening an app.
 */
export function ConsentForm({ query, organizationId, target }: { query: string; organizationId: string; target: string }) {
  const t = useTranslations("auth.oauth");
  const [state, action, pending] = useActionState(decideAuthorization, INITIAL);

  useEffect(() => {
    if (state.redirectTo) window.location.assign(state.redirectTo);
  }, [state.redirectTo]);

  if (state.redirectTo) {
    return (
      <div className="mt-6 space-y-4">
        <Alert tone="success">{t("returning", { target })}</Alert>
        <a className={buttonClasses("secondary", "w-full")} href={state.redirectTo}>
          {t("continue")}
        </a>
      </div>
    );
  }
  return (
    <form action={action} className="mt-6 space-y-4">
      <input type="hidden" name="query" value={query} />
      <input type="hidden" name="organization_id" value={organizationId} />
      {state.error ? <Alert>{t(`actionError.${state.error}`)}</Alert> : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <Button type="submit" name="decision" value="deny" variant="secondary" disabled={pending} className="h-12 text-base">
          {t("deny")}
        </Button>
        <Button type="submit" name="decision" value="allow" disabled={pending} className="h-12 text-base">
          {pending ? t("pleaseWait") : t("allow")}
        </Button>
      </div>
    </form>
  );
}
