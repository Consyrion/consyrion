import { ConsyrionMark, ConsyrionWordmark } from "@/components/brand/consyrion-logo";
import { ElectricLogo } from "@/components/brand/electric-logo";
import { CouncilNetwork } from "@/components/dashboard/council-network";
import { LiveMetricCard } from "@/components/dashboard/live-metric-card";
import { stepStatesFor, WorkflowStepper } from "@/components/dashboard/workflow-stepper";
import { AmbientBackground } from "@/components/fx/ambient-background";
import { Button } from "@/components/ui/button";
import { GlassPanel, NeonBorder } from "@/components/ui/glass";
import { Alert, Badge, EmptyState } from "@/components/ui/surface";
import { VoteWeightsDemo } from "@/components/vote-weights";

export const metadata = { title: "Design system", robots: { index: false } };

const SWATCHES = [
  "--bg",
  "--bg-2",
  "--surface",
  "--surface-2",
  "--primary",
  "--success",
  "--accent",
  "--magenta",
  "--warning",
  "--danger",
  "--text",
  "--muted",
];

/** Component gallery for review (issue #67). Every value on this page is a fixture and labelled as such. */
export default function DesignGalleryPage() {
  return (
    <div className="relative isolate min-h-screen">
      <AmbientBackground className="fixed" intensity={0.7} />
      <main className="mx-auto max-w-6xl space-y-10 px-4 py-10 md:px-8">
        <header>
          <p className="text-xs font-semibold tracking-widest text-primary">DESIGN SYSTEM</p>
          <h1 className="mt-1 font-[family-name:var(--font-display)] text-3xl font-semibold">CONSYRION AI component gallery</h1>
          <p className="mt-2 max-w-2xl text-muted">
            Glass surfaces, neon accents and motion states. All numbers below are demo fixtures. Toggle “reduce motion” in your OS to see the static variants.
          </p>
        </header>

        <section aria-labelledby="g-logo" className="space-y-4">
          <h2 id="g-logo" className="font-semibold">
            Logo
          </h2>
          <div className="grid gap-4 md:grid-cols-4">
            <GlassPanel className="grid place-items-center gap-2 p-6">
              <ConsyrionMark size={72} />
              <p className="text-xs text-muted">Static mark (fallback)</p>
            </GlassPanel>
            <GlassPanel className="grid place-items-center gap-2 p-6">
              <ElectricLogo size={72} mode="ambient" title="CONSYRION AI – ambient" />
              <p className="text-xs text-muted">Electric · ambient loop</p>
            </GlassPanel>
            <GlassPanel className="grid place-items-center gap-2 p-6">
              <ElectricLogo size={72} mode="hover" title="CONSYRION AI – hover" />
              <p className="text-xs text-muted">Electric · hover / focus</p>
            </GlassPanel>
            <GlassPanel className="grid place-items-center gap-3 p-6">
              <span className="flex items-center gap-2">
                <ConsyrionMark size={32} title="" />
                <ConsyrionWordmark className="text-sm" />
              </span>
              <p className="text-xs text-muted">Mark + wordmark</p>
            </GlassPanel>
          </div>
        </section>

        <section aria-labelledby="g-tokens" className="space-y-4">
          <h2 id="g-tokens" className="font-semibold">
            Tokens
          </h2>
          <ul className="grid grid-cols-3 gap-3 sm:grid-cols-6">
            {SWATCHES.map((token) => (
              <li key={token} className="glass-quiet rounded-xl p-2 text-xs">
                <span className="mb-2 block h-10 rounded-lg border border-glass-line" style={{ background: `var(${token})` }} />
                {token}
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="g-surfaces" className="space-y-4">
          <h2 id="g-surfaces" className="font-semibold">
            Surfaces & states
          </h2>
          <div className="grid gap-4 md:grid-cols-3">
            <GlassPanel className="p-5">
              <p className="font-medium">Glass panel</p>
              <p className="text-sm text-muted">Default container.</p>
            </GlassPanel>
            <GlassPanel glow="cyan" className="p-5">
              <p className="font-medium">Active (cyan glow)</p>
              <p className="text-sm text-muted">Selected or focused panel.</p>
            </GlassPanel>
            <GlassPanel quiet className="p-5">
              <p className="font-medium">Quiet panel</p>
              <p className="text-sm text-muted">Dense content: code, debates, tables.</p>
            </GlassPanel>
            <NeonBorder innerClassName="p-5">
              <p className="font-medium">Neon border</p>
              <p className="text-sm text-muted">Hero elements and key calls to action.</p>
            </NeonBorder>
            <GlassPanel className="flex flex-wrap items-center gap-2 p-5">
              <Button>Primary</Button>
              <Button variant="secondary">Secondary</Button>
              <Button variant="ghost">Ghost</Button>
              <Button variant="danger">Danger</Button>
              <Button disabled>Disabled</Button>
            </GlassPanel>
            <GlassPanel className="flex flex-wrap items-center gap-2 p-5">
              <Badge>neutral</Badge>
              <Badge tone="primary">running</Badge>
              <Badge tone="success">verified</Badge>
              <Badge tone="warning">awaiting approval</Badge>
              <Badge tone="danger">failed</Badge>
              <Badge tone="accent">accent</Badge>
            </GlassPanel>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            <Alert tone="success">Success: key verified with the provider.</Alert>
            <Alert tone="warning">Warning: low confidence – an evaluator failed.</Alert>
            <Alert>Error: the provider rejected the key.</Alert>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <EmptyState title="Empty state" description="No council sessions yet – create a project to start." />
            <GlassPanel className="p-5" aria-busy="true">
              <p className="font-medium">Loading state</p>
              <div className="mt-3 space-y-2" aria-hidden="true">
                <div className="h-3 w-2/3 rounded bg-surface-2" />
                <div className="h-3 w-1/2 rounded bg-surface-2" />
              </div>
            </GlassPanel>
          </div>
        </section>

        <section aria-labelledby="g-metrics" className="space-y-4">
          <h2 id="g-metrics" className="font-semibold">
            Live metric cards
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <LiveMetricCard demo label="Active projects" value={4} hint="1 archived" />
            <LiveMetricCard demo label="Council sessions" value={12} tone="violet" series={{ values: [12, 30, 22, 41, 38, 52, 47], label: "Demo series" }} />
            <LiveMetricCard demo label="Awaiting approval" value={2} tone="magenta" />
            <LiveMetricCard demo live label="Running now" value={1} tone="emerald" />
          </div>
        </section>

        <section aria-labelledby="g-weights" className="space-y-4">
          <h2 id="g-weights" className="font-semibold">
            Vote weights before the run (demo fixture)
          </h2>
          <VoteWeightsDemo />
        </section>

        <section aria-labelledby="g-workflow" className="space-y-4">
          <h2 id="g-workflow" className="font-semibold">
            Workflow & council
          </h2>
          <GlassPanel className="space-y-4 p-5">
            <WorkflowStepper states={stepStatesFor("minority_review", "running")} label="Demo: running" />
            <WorkflowStepper states={stepStatesFor("final_verdict", "awaiting_approval")} label="Demo: awaiting approval" />
            <WorkflowStepper states={stepStatesFor("open_council", "failed")} label="Demo: failed" />
          </GlassPanel>
          <div className="grid gap-4 md:grid-cols-2">
            <GlassPanel className="p-5">
              <CouncilNetwork
                caption="Demo fixture: one model working, two done, one failed."
                nodes={[
                  { id: "a", label: "Anthropic", sublabel: "demo-model-a", state: "working" },
                  { id: "b", label: "OpenAI", sublabel: "demo-model-b", state: "done" },
                  { id: "c", label: "Google", sublabel: "demo-model-c", state: "done" },
                  { id: "d", label: "DeepSeek", sublabel: "demo-model-d", state: "failed" },
                ]}
              />
            </GlassPanel>
            <GlassPanel className="p-5">
              <CouncilNetwork
                caption="Demo fixture: idle council – nothing pulses."
                nodes={["Architect", "Security", "Cost"].map((l) => ({ id: l, label: l, sublabel: l, state: "idle" as const }))}
              />
            </GlassPanel>
          </div>
        </section>
      </main>
    </div>
  );
}
