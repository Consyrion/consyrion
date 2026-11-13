import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { CodeWindow } from "@/components/connect/code-window";
import { ConnectIcon } from "@/components/connect/connect-icon";
import { Card } from "@/components/ui/surface";
import { OBSIDIAN_DOWNLOADS, SIGN_IN_SLUGS, TESTED_SIGN_IN_SLUGS, connectItem, connectSteps, isDetailSlug } from "@/lib/connect-catalog";

type Params = { params: Promise<{ client: string }> };

export async function generateMetadata({ params }: Params) {
  const { client } = await params;
  if (!isDetailSlug(client)) return {};
  const t = await getTranslations("settings.connect");
  return { title: t("detailTitle", { name: t(`items.${client}.name`) }) };
}

/** Where a <link> inside a step text points to. */
function stepLink(step: string): string {
  if (step === "token" || step === "connect" || step === "tokenAlt") return "/settings/api-tokens";
  return "/settings/integrations#delivery";
}

/** Public setup page for one tool: what it does, what it needs, numbered steps with copyable snippets. */
export default async function ConnectClientPage({ params }: Params) {
  const { client } = await params;
  const item = connectItem(client);
  if (!item || !isDetailSlug(client)) notFound();
  const t = await getTranslations("settings.connect");
  const origin = (process.env.BETTER_AUTH_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const steps = connectSteps(client, `${origin}/api/mcp`);
  const key = `items.${client}` as const;
  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/integrations" className="text-sm text-muted hover:text-text">
        ← {t("back")}
      </Link>
      <header className="mt-4 flex items-start gap-4">
        <ConnectIcon name={item.icon} brand={item.brand} className="size-12" />
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-2xl font-semibold tracking-tight">{t(`${key}.name`)}</h1>
          <p className="mt-1 text-muted">{t(`${key}.summary`)}</p>
        </div>
      </header>

      {item.needsMcp ? (
        <p className="mt-6 rounded-lg border border-glass-line bg-surface-2 px-4 py-3 text-sm text-muted">
          {t.rich("proOnly", {
            link: (chunks) => (
              <Link href="/#pricing" className="underline hover:text-text">
                {chunks}
              </Link>
            ),
          })}
        </p>
      ) : null}

      <Card className="mt-6">
        <h2 className="font-semibold">{t("whatTitle")}</h2>
        <p className="mt-1 text-sm text-muted">{t(`${key}.what`)}</p>
      </Card>

      <section className="mt-8" aria-labelledby="setup">
        <h2 id="setup" className="font-semibold">
          {t("setupTitle")}
        </h2>
        <ol className="mt-4 space-y-6">
          {steps.map((step, index) => (
            <li key={step.key} className="flex gap-4">
              <span
                aria-hidden
                className="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-full border border-glass-line bg-surface-2 text-xs font-semibold"
              >
                {index + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm">
                  {t.rich(step.shared ? `shared.${step.key}` : `${key}.steps.${step.key}`, {
                    link: (chunks) => (
                      <Link href={stepLink(step.key)} className="text-primary underline">
                        {chunks}
                      </Link>
                    ),
                    main: (chunks) => (
                      <a href={OBSIDIAN_DOWNLOADS.main} download className="text-primary underline">
                        {chunks}
                      </a>
                    ),
                    manifest: (chunks) => (
                      <a href={OBSIDIAN_DOWNLOADS.manifest} download className="text-primary underline">
                        {chunks}
                      </a>
                    ),
                    code: (chunks) => <code className="rounded bg-surface-2 px-1 py-0.5 font-mono text-xs">{chunks}</code>,
                  })}
                </p>
                {step.install ? (
                  <a
                    href={step.install}
                    className="mt-3 inline-flex items-center rounded-lg border border-primary/60 bg-surface-2 px-3 py-1.5 text-sm font-medium text-text hover:border-primary focus-visible:outline-2 focus-visible:outline-focus"
                  >
                    {t("shared.addButton", { name: t(`${key}.name`) })}
                  </a>
                ) : null}
                {step.code ? <CodeWindow label={step.code.label} text={step.code.text} /> : null}
              </div>
            </li>
          ))}
        </ol>
      </section>

      {SIGN_IN_SLUGS.includes(client) ? (
        <p className="mt-10 text-xs text-muted">{t(TESTED_SIGN_IN_SLUGS.includes(client) ? "shared.tested" : "shared.untested", { name: t(`${key}.name`) })}</p>
      ) : null}
      <p className={`${SIGN_IN_SLUGS.includes(client) ? "mt-3" : "mt-10 border-t border-glass-line"} pt-4 text-xs text-muted`}>{t("safety")}</p>
    </div>
  );
}
