import { COUNCIL_PHASES, COUNCIL_PHASE_LABELS, type CouncilPhase } from "@consyrion/core";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { LanguageSwitcher } from "../language-switcher";
import { ConsyrionWordmark } from "../brand/consyrion-logo";
import { ElectricLogo } from "../brand/electric-logo";
import { RibbonField } from "../fx/ribbon-field";
import { DELIVERY_TARGETS } from "./delivery-targets";

const targetKey = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z]+/g, "_")
    .replace(/^_|_$/g, "");
import { buttonClasses } from "../ui/button";
import { GlassPanel, NeonBorder } from "../ui/glass";
import { MobileMenu } from "./mobile-menu";
import { ProcessStory } from "./process-story";

/** Calls to action of the landing page. Every target is a real route of the app (checked in tests). */
export const LANDING_CTAS = {
  start: { label: "Start a Decision", href: "/projects/new" },
  how: { label: "See How It Works", href: "#prepare" },
  keys: { label: "Connect Your AI Keys", href: "/settings/providers" },
  signUp: { label: "Start for free", href: "/sign-up" },
  pro: { label: "Choose Pro", href: "/settings/billing" },
} as const;

/** Public source repository (AGPL-3.0) and its self-hosting guide. */
export const SOURCE_URL = "https://github.com/Consyrion/consyrion";
export const SELF_HOSTING_URL = "https://github.com/Consyrion/consyrion/blob/main/docs/self-hosting.md";

/** Owner request 07.11.26: advantages, MCP & Telegram, open source and prices on the homepage (copy reviewed with ChatGPT). */
const WHY_POINTS = ["perspectives", "review", "requirements", "transparent", "control"] as const;
const CHANNELS = ["mcp", "telegram"] as const;
/** Hosted plan facts mirror plan_definition (migration 0029) – change both together. */
const PLANS = [
  { key: "selfhost", points: 5, href: SOURCE_URL, external: true, highlight: false },
  { key: "free", points: 5, href: LANDING_CTAS.signUp.href, external: false, highlight: false },
  // Signed out, /settings/billing would only bounce to the sign-in page – new visitors create an account first.
  { key: "pro", points: 5, href: LANDING_CTAS.signUp.href, external: false, highlight: true },
] as const;

const PROVIDERS = [
  { name: "Anthropic", family: "Claude" },
  { name: "OpenAI", family: "GPT" },
  { name: "Google", family: "Gemini" },
  { name: "DeepSeek", family: "DeepSeek" },
  { name: "Z.ai", family: "GLM" },
  { name: "Moonshot", family: "Kimi" },
  { name: "Alibaba Cloud", family: "Qwen" },
  { name: "xAI", family: "Grok" },
];

export const PHASE_COPY: Record<CouncilPhase, string> = {
  independent_thinking: "Every model receives the identical brief and answers blind. No model sees another proposal before the reveal.",
  open_council: "All proposals are revealed side by side. Models ask each other precise questions and answer them.",
  twelve_minds_council: "Up to twelve perspectives – architecture, security, cost, critic and more – review every proposal.",
  minority_review: "Dissent is first-class. Substantiated objections are checked by independent models and may stay unresolved.",
  consensus_round: "Authors revise their proposals against the objections. Agreements and open disagreements are documented.",
  final_verdict: "Independent scores, hard gates and a separate majority vote produce a reproducible verdict – then you decide.",
  execution_council: "Optional, with a connected GitHub repository: after your approval a task plan, sandboxed code, tests, reviews and a draft pull request.",
};

const HIGHLIGHT = new Set<CouncilPhase>(["twelve_minds_council", "minority_review", "final_verdict", "execution_council"]);

const BUILD_STEPS = ["approve", "plan", "code", "review", "pr"] as const;

export async function LandingPage({ signedIn }: { signedIn: boolean }) {
  const t = await getTranslations("landing");
  return (
    <div className="stage-dark relative isolate min-h-screen overflow-x-clip bg-bg text-text">
      <RibbonField intensity={1.9} interactive />
      <a
        href="#content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-surface focus:px-3 focus:py-2"
      >
        {t("nav.skip")}
      </a>

      <header className="glass sticky top-0 z-30 rounded-none border-x-0 border-t-0">
        <nav aria-label={t("nav.main")} className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 md:px-8">
          <Link href="/" className="flex items-center gap-2.5" aria-label={t("nav.home")}>
            <ElectricLogo size={32} mode="intro" title="" />
            <ConsyrionWordmark className="text-sm" />
          </Link>
          <div className="hidden items-center gap-5 whitespace-nowrap text-sm text-muted md:flex">
            <a href="#how" className="hover:text-text">
              {t("nav.how")}
            </a>
            <a href="#overview" className="hover:text-text max-2xl:hidden">
              {t("nav.overview")}
            </a>
            <a href="#byok" className="hover:text-text">
              {t("nav.keys")}
            </a>
            <a href="#delivery" className="hover:text-text max-2xl:hidden">
              {t("nav.delivery")}
            </a>
            <a href="#open-source" className="hover:text-text">
              {t("nav.openSource")}
            </a>
            <a href="#pricing" className="hover:text-text">
              {t("nav.pricing")}
            </a>
            <Link href="/integrations" className="hover:text-text max-xl:hidden">
              {t("nav.integrations")}
            </Link>
          </div>
          <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
            {/* Narrow screens: the section links, language and sign-in live in this menu (ChatGPT QA 07.11.26). */}
            <MobileMenu label={t("nav.menu")} summaryClassName={buttonClasses("secondary", "cursor-pointer list-none px-3 [&::-webkit-details-marker]:hidden")}>
              {(["how", "overview", "byok", "delivery", "open-source", "pricing"] as const).map((id) => (
                <a key={id} href={`#${id}`} className="rounded-lg px-3 py-2 text-muted hover:bg-surface-2 hover:text-text">
                  {t(`nav.${{ how: "how", overview: "overview", byok: "keys", delivery: "delivery", "open-source": "openSource", pricing: "pricing" }[id]}`)}
                </a>
              ))}
              <Link href="/integrations" className="rounded-lg px-3 py-2 text-muted hover:bg-surface-2 hover:text-text">
                {t("nav.integrations")}
              </Link>
              {signedIn ? null : (
                <Link href="/sign-in" className="rounded-lg px-3 py-2 text-muted hover:bg-surface-2 hover:text-text">
                  {t("nav.signIn")}
                </Link>
              )}
              <div className="px-3 pt-2">
                <LanguageSwitcher />
              </div>
            </MobileMenu>
            <LanguageSwitcher className="max-sm:hidden" />
            {signedIn ? (
              <Link href="/dashboard" className={buttonClasses("secondary", "whitespace-nowrap max-sm:px-3")}>
                <span className="max-sm:hidden">{t("nav.openDashboard")}</span>
                <span className="sm:hidden">{t("nav.dashboardShort")}</span>
              </Link>
            ) : (
              <Link href="/sign-in" className={buttonClasses("ghost", "max-sm:hidden")}>
                {t("nav.signIn")}
              </Link>
            )}
            {/* Narrow screens show "Start"; the accessible name keeps the full label. */}
            <Link href={LANDING_CTAS.start.href} aria-label={t("cta.start")} className={buttonClasses("primary", "whitespace-nowrap max-sm:px-3")}>
              <span className="max-sm:hidden">{t("cta.start")}</span>
              <span className="sm:hidden">{t("nav.startShort")}</span>
            </Link>
          </div>
        </nav>
      </header>

      <main id="content">
        <ProcessStory
          start={{ ...LANDING_CTAS.start, label: t("cta.start") }}
          secondary={{ ...LANDING_CTAS.how, label: t("cta.how") }}
          signIn={signedIn ? { label: t("nav.openDashboard"), href: "/dashboard" } : { label: t("nav.signIn"), href: "/sign-in" }}
        />

        {/* Compact overview after the scroll story: every stage and the build path on one screen. */}
        <section id="overview" className="mx-auto max-w-6xl scroll-mt-24 px-4 py-16 md:px-8" aria-labelledby="overview-title">
          <h2 id="overview-title" className="font-[family-name:var(--font-display)] text-3xl font-semibold">
            {t("overview.title")}
          </h2>
          <p className="mt-2 max-w-2xl text-muted">{t("overview.text")}</p>
          <ol className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {COUNCIL_PHASES.map((phase, index) => (
              <li key={phase}>
                <GlassPanel as="article" glow={HIGHLIGHT.has(phase) ? (phase === "execution_council" ? "violet" : "cyan") : "none"} className="h-full p-5">
                  <p className="text-xs font-semibold tracking-widest text-primary">{t("overview.stage", { n: index + 1 })}</p>
                  <h3 className="mt-2 font-semibold">{COUNCIL_PHASE_LABELS[phase]}</h3>
                  <p className="mt-2 text-sm text-muted">{t(`phase.${phase}`)}</p>
                </GlassPanel>
              </li>
            ))}
            <li>
              <GlassPanel as="article" className="flex h-full flex-col justify-center p-5">
                <p className="text-xs font-semibold tracking-widest text-warning">{t("overview.gateKicker")}</p>
                <p className="mt-2 text-sm">{t("overview.gateText")}</p>
              </GlassPanel>
            </li>
          </ol>
        </section>

        <section id="why" className="mx-auto max-w-6xl scroll-mt-24 px-4 py-16 md:px-8" aria-labelledby="why-title">
          <h2 id="why-title" className="font-[family-name:var(--font-display)] text-3xl font-semibold">
            {t("why.title")}
          </h2>
          <p className="mt-2 max-w-2xl text-muted">{t("why.text")}</p>
          <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {WHY_POINTS.map((key) => (
              <li key={key}>
                <GlassPanel as="article" className="h-full p-5">
                  <h3 className="font-semibold">{t(`why.points.${key}.title`)}</h3>
                  <p className="mt-2 text-sm text-muted">{t(`why.points.${key}.text`)}</p>
                </GlassPanel>
              </li>
            ))}
          </ul>
        </section>

        <section id="byok" className="mx-auto max-w-6xl scroll-mt-24 px-4 py-16 md:px-8" aria-labelledby="byok-title">
          <GlassPanel className="grid gap-8 p-6 md:grid-cols-[1fr_1.2fr] md:p-10">
            <div>
              <h2 id="byok-title" className="font-[family-name:var(--font-display)] text-3xl font-semibold">
                {t("byok.title")}
              </h2>
              <p className="mt-3 text-muted">{t("byok.text")}</p>
              <ul className="mt-5 space-y-2 text-sm">
                <li>• {t("byok.p1")}</li>
                <li>• {t("byok.p2")}</li>
                <li>• {t("byok.p3")}</li>
              </ul>
              <Link href={LANDING_CTAS.keys.href} className={buttonClasses("primary", "mt-6")}>
                {t("cta.keys")}
              </Link>
            </div>
            <ul className="grid grid-cols-2 gap-3 self-center" aria-label={t("byok.providers")}>
              {PROVIDERS.map((p) => (
                <li key={p.name} className="glass-quiet rounded-xl p-4">
                  <p className="font-semibold">{p.name}</p>
                  <p className="text-sm text-muted">{t("byok.models", { name: p.family })}</p>
                  <p className="mt-2 text-xs text-muted">{t("byok.ownKey")}</p>
                </li>
              ))}
            </ul>
          </GlassPanel>
        </section>

        {/* #163: the decision is the product; where it goes is the user's choice. Unbuilt targets are marked planned. */}
        <section id="delivery" className="mx-auto max-w-6xl scroll-mt-24 px-4 py-16 md:px-8" aria-labelledby="delivery-title">
          <h2 id="delivery-title" className="font-[family-name:var(--font-display)] text-3xl font-semibold">
            {t("delivery.title")}
          </h2>
          <p className="mt-2 max-w-2xl text-muted">{t("delivery.text")}</p>
          <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {DELIVERY_TARGETS.map((target) => (
              <li key={target.name}>
                <GlassPanel as="article" glow={target.status === "available" ? "cyan" : "none"} className="h-full p-5">
                  <p
                    className={`text-xs font-semibold tracking-widest ${target.status === "available" ? "text-success" : target.status === "with_github" ? "text-accent-text" : "text-muted"}`}
                  >
                    {t(`delivery.status.${target.status}`).toUpperCase()}
                  </p>
                  <h3 className="mt-2 font-semibold">{t(`delivery.targets.${targetKey(target.name)}.name`)}</h3>
                  <p className="mt-2 text-sm text-muted">{t(`delivery.targets.${targetKey(target.name)}.detail`)}</p>
                </GlassPanel>
              </li>
            ))}
          </ul>
        </section>

        <section id="channels" className="mx-auto max-w-6xl scroll-mt-24 px-4 py-16 md:px-8" aria-labelledby="channels-title">
          <h2 id="channels-title" className="font-[family-name:var(--font-display)] text-3xl font-semibold">
            {t("channels.title")}
          </h2>
          <p className="mt-2 max-w-2xl text-muted">{t("channels.text")}</p>
          <ul className="mt-8 grid gap-4 md:grid-cols-2">
            {CHANNELS.map((key) => (
              <li key={key}>
                <GlassPanel as="article" glow="cyan" className="h-full p-6">
                  <p className="text-xs font-semibold tracking-widest text-accent-text">{t(`channels.${key}.kicker`).toUpperCase()}</p>
                  <h3 className="mt-2 text-xl font-semibold">{t(`channels.${key}.title`)}</h3>
                  <p className="mt-2 text-sm text-muted">{t(`channels.${key}.text`)}</p>
                  <ul className="mt-4 space-y-2 text-sm">
                    {[1, 2, 3].map((n) => (
                      <li key={n}>• {t(`channels.${key}.p${n}`)}</li>
                    ))}
                  </ul>
                </GlassPanel>
              </li>
            ))}
          </ul>
        </section>

        <section id="pipeline" className="mx-auto max-w-6xl scroll-mt-24 px-4 py-16 md:px-8" aria-labelledby="pipeline-title">
          <h2 id="pipeline-title" className="font-[family-name:var(--font-display)] text-3xl font-semibold">
            {t("pipeline.title")}
          </h2>
          <p className="mt-2 max-w-2xl text-muted">{t("pipeline.text")}</p>
          <ol className="mt-8 grid gap-4 md:grid-cols-5">
            {BUILD_STEPS.map((s, i) => (
              <li key={s}>
                <GlassPanel as="article" glow={i === BUILD_STEPS.length - 1 ? "violet" : "none"} className="h-full p-5">
                  <p className="text-xs font-semibold tracking-widest text-accent-text">{String(i + 1).padStart(2, "0")}</p>
                  <h3 className="mt-2 font-semibold">{t(`pipeline.steps.${s}.title`)}</h3>
                  <p className="mt-2 text-sm text-muted">{t(`pipeline.steps.${s}.text`)}</p>
                </GlassPanel>
              </li>
            ))}
          </ol>
        </section>

        <section id="open-source" className="mx-auto max-w-6xl scroll-mt-24 px-4 py-16 md:px-8" aria-labelledby="open-source-title">
          <GlassPanel className="grid gap-8 p-6 md:grid-cols-[1.2fr_1fr] md:p-10">
            <div>
              <h2 id="open-source-title" className="font-[family-name:var(--font-display)] text-3xl font-semibold">
                {t("openSource.title")}
              </h2>
              <p className="mt-3 text-muted">{t("openSource.text")}</p>
              <div className="mt-6 flex flex-wrap gap-3">
                <a href={SOURCE_URL} className={buttonClasses("primary")}>
                  {t("openSource.cta")}
                </a>
                <a href={SELF_HOSTING_URL} className={buttonClasses("secondary")}>
                  {t("openSource.guide")}
                </a>
              </div>
            </div>
            <ul className="space-y-3 self-center text-sm">
              {[1, 2, 3, 4].map((n) => (
                <li key={n} className="glass-quiet rounded-xl p-4">
                  {t(`openSource.p${n}`)}
                </li>
              ))}
            </ul>
          </GlassPanel>
        </section>

        <section id="pricing" className="mx-auto max-w-6xl scroll-mt-24 px-4 py-16 md:px-8" aria-labelledby="pricing-title">
          <h2 id="pricing-title" className="font-[family-name:var(--font-display)] text-3xl font-semibold">
            {t("pricing.title")}
          </h2>
          <p className="mt-2 max-w-2xl text-muted">{t("pricing.text")}</p>
          <ul className="mt-8 grid gap-4 md:grid-cols-3">
            {PLANS.map((p) => ({ ...p, href: p.key === "pro" && signedIn ? LANDING_CTAS.pro.href : p.href })).map((plan) => (
              <li key={plan.key}>
                <GlassPanel as="article" glow={plan.highlight ? "violet" : "none"} className="flex h-full flex-col p-6">
                  <h3 className="text-lg font-semibold">{t(`pricing.plans.${plan.key}.name`)}</h3>
                  <p className="mt-2 font-[family-name:var(--font-display)] text-3xl font-semibold">{t(`pricing.plans.${plan.key}.price`)}</p>
                  <p className="text-xs text-muted">{t(`pricing.plans.${plan.key}.priceNote`)}</p>
                  <ul className="mt-5 flex-1 space-y-2 text-sm">
                    {Array.from({ length: plan.points }, (_, i) => (
                      <li key={i}>• {t(`pricing.plans.${plan.key}.p${i + 1}`)}</li>
                    ))}
                  </ul>
                  {plan.external ? (
                    <a href={plan.href} className={buttonClasses(plan.highlight ? "primary" : "secondary", "mt-6")}>
                      {t(`pricing.plans.${plan.key}.cta`)}
                    </a>
                  ) : (
                    <Link href={plan.href} className={buttonClasses(plan.highlight ? "primary" : "secondary", "mt-6")}>
                      {t(`pricing.plans.${plan.key}.cta`)}
                    </Link>
                  )}
                </GlassPanel>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-sm text-muted">{t("pricing.note")}</p>
        </section>

        <section className="mx-auto max-w-6xl px-4 pb-20 pt-6 md:px-8">
          <NeonBorder innerClassName="flex flex-col items-start justify-between gap-4 p-8 md:flex-row md:items-center">
            <div>
              <h2 className="font-[family-name:var(--font-display)] text-2xl font-semibold">{t("closing.title")}</h2>
              <p className="mt-1 text-muted">{t("closing.text")}</p>
            </div>
            <Link href={LANDING_CTAS.start.href} className={buttonClasses("primary", "px-6")}>
              {t("cta.start")}
            </Link>
          </NeonBorder>
        </section>
      </main>

      <footer className="border-t border-glass-line">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-8 text-sm text-muted md:px-8">
          <span className="flex items-center gap-2">
            <ElectricLogo size={20} mode="hover" title="" />
            <ConsyrionWordmark className="text-xs" />
          </span>
          <span>© {new Date().getFullYear()} CONSYRION AI</span>
          <span className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <Link href="/sign-in" className="hover:text-text">
              {t("footer.signIn")}
            </Link>
            <Link href="/sign-up" className="hover:text-text">
              {t("footer.signUp")}
            </Link>
            <Link href="/impressum" className="hover:text-text">
              {t("footer.impressum")}
            </Link>
            <Link href="/agb" className="hover:text-text">
              {t("footer.agb")}
            </Link>
            <Link href="/datenschutz" className="hover:text-text">
              {t("footer.datenschutz")}
            </Link>
            <Link href="/integrations" className="hover:text-text">
              {t("footer.integrations")}
            </Link>
            <Link href="/feedback?from=/" className="hover:text-text">
              {t("footer.feedback")}
            </Link>
            <a href={SOURCE_URL} className="hover:text-text">
              {t("footer.source")}
            </a>
            <LanguageSwitcher />
          </span>
        </div>
      </footer>
    </div>
  );
}
