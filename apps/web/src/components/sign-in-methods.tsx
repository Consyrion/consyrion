"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { authClient } from "@/lib/auth-client";
import { Button } from "./ui/button";
import { GlassPanel } from "./ui/glass";
import { Alert, Badge } from "./ui/surface";

type Provider = "google" | "github";

// Google and GitHub are product names; the e-mail method is translated (auth.methods.credential).
const LABELS: Record<string, string> = { google: "Google", github: "GitHub" };

/** Lists the sign-in methods of the current user and lets them connect or remove social logins. */
export function SignInMethods({ providers }: { providers: Provider[] }) {
  const [accounts, setAccounts] = useState<Array<{ id: string; providerId: string }> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const t = useTranslations("auth.methods");
  const methodLabel = (method: string) => (method === "credential" ? t("credential") : (LABELS[method] ?? method));

  const load = useCallback(async () => {
    const result = await authClient.listAccounts();
    if (result.error) setError(result.error.message ?? t("errorLoad"));
    else setAccounts(result.data.map((a) => ({ id: a.id, providerId: a.providerId })));
  }, []);

  useEffect(() => {
    void load();
    // Better Auth returns to this page with ?error=… when linking failed (e.g. already used by another account).
    const failure = new URLSearchParams(window.location.search).get("error");
    if (failure) setError(failure === "account_already_linked_to_different_user" ? t("alreadyLinked") : t("connectFailedCode", { code: failure }));
  }, [load]);

  async function connect(provider: Provider) {
    setBusy(provider);
    setError(null);
    const result = await authClient.linkSocial({ provider, callbackURL: "/settings/account?linked=1" });
    if (result.error) {
      setError(result.error.message ?? t("connectFailed"));
      setBusy(null);
    }
  }

  async function remove(accountId: string) {
    setBusy(accountId);
    setError(null);
    const result = await authClient.unlinkAccount({ accountId });
    if (result.error) setError(result.error.message ?? t("errorRemove"));
    await load();
    setBusy(null);
  }

  const methods = ["credential", ...providers];
  const linked = accounts?.map((a) => a.providerId) ?? null;
  return (
    <div className="space-y-4">
      {error ? <Alert>{error}</Alert> : null}
      <GlassPanel className="divide-y divide-glass-line p-0">
        {methods.map((method) => {
          const isLinked = linked?.includes(method) ?? false;
          const canRemove = isLinked && method !== "credential" && (linked?.length ?? 0) > 1;
          return (
            <div key={method} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
              <div>
                <p className="font-medium">{methodLabel(method)}</p>
                <p className="text-sm text-muted">{isLinked ? t("signsIn") : method === "credential" ? t("notSetUp") : t("notConnected")}</p>
              </div>
              <div className="flex items-center gap-2">
                {linked === null ? <Badge>{t("loading")}</Badge> : isLinked ? <Badge tone="success">{t("connected")}</Badge> : null}
                {linked !== null && !isLinked && method !== "credential" ? (
                  <Button variant="secondary" disabled={busy !== null} onClick={() => void connect(method as Provider)}>
                    {busy === method ? t("redirecting") : t("connect", { provider: methodLabel(method) })}
                  </Button>
                ) : null}
                {canRemove ? (
                  <Button variant="ghost" disabled={busy !== null} onClick={() => void remove(accounts!.find((a) => a.providerId === method)!.id)}>
                    {t("remove")}
                  </Button>
                ) : null}
              </div>
            </div>
          );
        })}
      </GlassPanel>
      <p className="text-sm text-muted">{t("footer")}</p>
    </div>
  );
}
