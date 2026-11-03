import { COUNCIL_PHASES, COUNCIL_PHASE_LABELS, type CouncilPhase } from "@consyrion/core";
import Link from "next/link";
import { ConsyrionWordmark } from "../brand/consyrion-logo";
import { ElectricLogo } from "../brand/electric-logo";
import { RibbonField } from "../fx/ribbon-field";
import { DELIVERY_STATUS_LABEL, DELIVERY_TARGETS } from "./delivery-targets";
import { buttonClasses } from "../ui/button";
import { GlassPanel, NeonBorder } from "../ui/glass";
import { ProcessStory } from "./process-story";

/** Calls to action of the landing page. Every target is a real route of the app (checked in tests). */
export const LANDING_CTAS = {
  start: { label: "Start a Decision", href: "/projects/new" },
  how: { label: "See How It Works", href: "#prepare" },
  keys: { label: "Connect Your AI Keys", href: "/settings/providers" },
} as const;

const PROVIDERS = [
  { name: "Anthropic", detail: "Claude models" },
  { name: "OpenAI", detail: "GPT models" },
  { name: "Google", detail: "Gemini models" },
  { name: "DeepSeek", detail: "DeepSeek models" },
  { name: "Z.ai", detail: "GLM models" },
  { name: "Moonshot", detail: "Kimi models" },
  { name: "Alibaba Cloud", detail: "Qwen models" },
  { name: "xAI", detail: "Grok models" },
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

const BUILD_STEPS = [
  { title: "Approve", text: "A human approves the verdict. Nothing is built before that." },
  { title: "Plan", text: "The Execution Council turns the verdict into a validated task graph." },
  { title: "Code & test", text: "Code runs only in an isolated container sandbox without network access." },
  { title: "Review", text: "Independent models review the change; findings stay visible." },
  { title: "Pull request", text: "A draft pull request opens in your repository through the GitHub App." },
];

export function LandingPage({ signedIn }: { signedIn: boolean }) {
  return (
    <div className="stage-dark relative isolate min-h-screen overflow-x-clip bg-bg text-text">
      <RibbonField intensity={1.9} interactive />
      <a
        href="#content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-surface focus:px-3 focus:py-2"
      >
        Skip to content
      </a>

      <header className="glass sticky top-0 z-30 rounded-none border-x-0 border-t-0">
        <nav aria-label="Main" className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 md:px-8">
          <Link href="/" className="flex items-center gap-2.5" aria-label="CONSYRION AI home">
            <ElectricLogo size={32} mode="intro" title="" />
            <ConsyrionWordmark className="text-sm" />
          </Link>
          <div className="hidden items-center gap-6 text-sm text-muted md:flex">
            <a href="#how" className="hover:text-text">
              How it works
            </a>
            <a href="#overview" className="hover:text-text">
              Overview
            </a>
            <a href="#byok" className="hover:text-text">
              Your AI keys
            </a>
            <a href="#delivery" className="hover:text-text">
              Delivery
            </a>
          </div>
          <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
            {signedIn ? (
              <Link href="/dashboard" className={buttonClasses("secondary", "whitespace-nowrap max-sm:px-3")}>
                <span className="max-sm:hidden">Open dashboard</span>
                <span className="sm:hidden">Dashboard</span>
              </Link>
            ) : (
              <Link href="/sign-in" className={buttonClasses("ghost", "max-sm:hidden")}>
                Sign in
              </Link>
            )}
            {/* Narrow screens show "Start"; the accessible name keeps the full label. */}
            <Link href={LANDING_CTAS.start.href} aria-label={LANDING_CTAS.start.label} className={buttonClasses("primary", "whitespace-nowrap max-sm:px-3")}>
              <span className="max-sm:hidden">{LANDING_CTAS.start.label}</span>
              <span className="sm:hidden">Start</span>
            </Link>
          </div>
        </nav>
      </header>

      <main id="content">
        <ProcessStory
          start={LANDING_CTAS.start}
          secondary={LANDING_CTAS.how}
          signIn={signedIn ? { label: "Open dashboard", href: "/dashboard" } : { label: "Sign in", href: "/sign-in" }}
        />

        {/* Compact overview after the scroll story: every stage and the build path on one screen. */}
        <section id="overview" className="mx-auto max-w-6xl scroll-mt-24 px-4 py-16 md:px-8" aria-labelledby="overview-title">
          <h2 id="overview-title" className="font-[family-name:var(--font-display)] text-3xl font-semibold">
            The process at a glance
          </h2>
          <p className="mt-2 max-w-2xl text-muted">
            Seven canonical stages. Modes – Independent Expert, Adversarial Review, Consensus – change how the council is orchestrated, not just the wording.
          </p>
          <ol className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {COUNCIL_PHASES.map((phase, index) => (
              <li key={phase}>
                <GlassPanel as="article" glow={HIGHLIGHT.has(phase) ? (phase === "execution_council" ? "violet" : "cyan") : "none"} className="h-full p-5">
                  <p className="text-xs font-semibold tracking-widest text-primary">STAGE {index + 1}</p>
                  <h3 className="mt-2 font-semibold">{COUNCIL_PHASE_LABELS[phase]}</h3>
                  <p className="mt-2 text-sm text-muted">{PHASE_COPY[phase]}</p>
                </GlassPanel>
              </li>
            ))}
            <li>
              <GlassPanel as="article" className="flex h-full flex-col justify-center p-5">
                <p className="text-xs font-semibold tracking-widest text-warning">HUMAN GATE</p>
                <p className="mt-2 text-sm">
                  Approve, select an alternative, request more debate, request changes or reject. Proposals with a critical security objection cannot be
                  approved.
                </p>
              </GlassPanel>
            </li>
          </ol>
        </section>

        <section id="byok" className="mx-auto max-w-6xl scroll-mt-24 px-4 py-16 md:px-8" aria-labelledby="byok-title">
          <GlassPanel className="grid gap-8 p-6 md:grid-cols-[1fr_1.2fr] md:p-10">
            <div>
              <h2 id="byok-title" className="font-[family-name:var(--font-display)] text-3xl font-semibold">
                Your keys. Your providers.
              </h2>
              <p className="mt-3 text-muted">
                CONSYRION AI is bring-your-own-key only. You connect your own API keys and pay the providers directly – CONSYRION AI sells no AI credits and has
                no fallback key.
              </p>
              <ul className="mt-5 space-y-2 text-sm">
                <li>• Keys are encrypted with AES-256-GCM before they are stored and are never shown again.</li>
                <li>• Each key is checked against the provider; model lists come live from the provider.</li>
                <li>• Every session has a hard token budget that is enforced on the server.</li>
              </ul>
              <Link href={LANDING_CTAS.keys.href} className={buttonClasses("primary", "mt-6")}>
                {LANDING_CTAS.keys.label}
              </Link>
            </div>
            <ul className="grid grid-cols-2 gap-3 self-center" aria-label="Supported AI providers">
              {PROVIDERS.map((p) => (
                <li key={p.name} className="glass-quiet rounded-xl p-4">
                  <p className="font-semibold">{p.name}</p>
                  <p className="text-sm text-muted">{p.detail}</p>
                  <p className="mt-2 text-xs text-muted">Your own API key</p>
                </li>
              ))}
            </ul>
          </GlassPanel>
        </section>

        {/* #163: the decision is the product; where it goes is the user's choice. Unbuilt targets are marked planned. */}
        <section id="delivery" className="mx-auto max-w-6xl scroll-mt-24 px-4 py-16 md:px-8" aria-labelledby="delivery-title">
          <h2 id="delivery-title" className="font-[family-name:var(--font-display)] text-3xl font-semibold">
            Your decision, where you work
          </h2>
          <p className="mt-2 max-w-2xl text-muted">
            Most teams need the reasoned decision, not code. Take the verdict as a report or into your tools – a pull request is one option, only with a
            connected repository.
          </p>
          <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {DELIVERY_TARGETS.map((t) => (
              <li key={t.name}>
                <GlassPanel as="article" glow={t.status === "available" ? "cyan" : "none"} className="h-full p-5">
                  <p
                    className={`text-xs font-semibold tracking-widest ${t.status === "available" ? "text-success" : t.status === "with_github" ? "text-accent-text" : "text-muted"}`}
                  >
                    {DELIVERY_STATUS_LABEL[t.status].toUpperCase()}
                  </p>
                  <h3 className="mt-2 font-semibold">{t.name}</h3>
                  <p className="mt-2 text-sm text-muted">{t.detail}</p>
                </GlassPanel>
              </li>
            ))}
          </ul>
        </section>

        <section id="pipeline" className="mx-auto max-w-6xl scroll-mt-24 px-4 py-16 md:px-8" aria-labelledby="pipeline-title">
          <h2 id="pipeline-title" className="font-[family-name:var(--font-display)] text-3xl font-semibold">
            Optional: from verdict to pull request
          </h2>
          <p className="mt-2 max-w-2xl text-muted">
            With a connected GitHub repository the Execution Council can build an approved decision – reviewed, tested and always as a draft for you to merge.
          </p>
          <ol className="mt-8 grid gap-4 md:grid-cols-5">
            {BUILD_STEPS.map((s, i) => (
              <li key={s.title}>
                <GlassPanel as="article" glow={i === BUILD_STEPS.length - 1 ? "violet" : "none"} className="h-full p-5">
                  <p className="text-xs font-semibold tracking-widest text-accent-text">{String(i + 1).padStart(2, "0")}</p>
                  <h3 className="mt-2 font-semibold">{s.title}</h3>
                  <p className="mt-2 text-sm text-muted">{s.text}</p>
                </GlassPanel>
              </li>
            ))}
          </ol>
        </section>

        <section className="mx-auto max-w-6xl px-4 pb-20 pt-6 md:px-8">
          <NeonBorder innerClassName="flex flex-col items-start justify-between gap-4 p-8 md:flex-row md:items-center">
            <div>
              <h2 className="font-[family-name:var(--font-display)] text-2xl font-semibold">Bring your next hard decision to the council.</h2>
              <p className="mt-1 text-muted">Describe an idea, an architecture question or connect a repository.</p>
            </div>
            <Link href={LANDING_CTAS.start.href} className={buttonClasses("primary", "px-6")}>
              {LANDING_CTAS.start.label}
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
          <span className="flex gap-4">
            <Link href="/sign-in" className="hover:text-text">
              Sign in
            </Link>
            <Link href="/sign-up" className="hover:text-text">
              Create an account
            </Link>
          </span>
        </div>
      </footer>
    </div>
  );
}
