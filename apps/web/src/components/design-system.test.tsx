import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { COUNCIL_PHASE_LABELS } from "@consyrion/core";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ICON_SVG, LOGO_SVG, MARK_SVG } from "../../scripts/brand-assets";
import { AuthShell } from "./auth-shell";
import { PasswordField } from "./ui/password-field";
import { ConsyrionOrbitalLogo, orbitAngle, orbitState } from "./brand/orbital-logo";
import { ActivityNetwork } from "./dashboard/activity-network";
import { failureSummary, objectionProgress, voiceStates } from "./session/council-room";
import type { View } from "./session/helpers";
import { ConsyrionMark } from "./brand/consyrion-logo";
import { ElectricLockup } from "./brand/electric-lockup";
import { ElectricLogo } from "./brand/electric-logo";
import { PHASE_NODES } from "./brand/geometry";
import { CouncilNetwork } from "./dashboard/council-network";
import { LiveMetricCard } from "./dashboard/live-metric-card";
import { stepStatesFor, WorkflowStepper } from "./dashboard/workflow-stepper";
import { LANDING_CTAS, LandingPage } from "./landing/landing-page";

const appDir = fileURLToPath(new URL("../app/", import.meta.url));

/** All page routes of the App Router, with route groups like "(app)" removed. */
function pageRoutes(dir = appDir, prefix = ""): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      const segment = entry.startsWith("(") ? "" : `/${entry}`;
      return pageRoutes(full, prefix + segment);
    }
    return entry === "page.tsx" ? [prefix || "/"] : [];
  });
}

describe("Consyrion logo", () => {
  it("renders an accessible static mark with seven phase nodes", () => {
    const html = renderToStaticMarkup(<ConsyrionMark title="CONSYRION AI" />);
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="CONSYRION AI"');
    expect(html.match(/<circle/g)).toHaveLength(PHASE_NODES.length + 2);
    expect(PHASE_NODES).toHaveLength(7);
  });

  it("is decorative when visible text already names it", () => {
    const html = renderToStaticMarkup(<ConsyrionMark title="" />);
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toContain("role=");
  });

  it("server-renders the Electric Logo as the static fallback (no animation before hydration)", () => {
    const html = renderToStaticMarkup(<ElectricLogo mode="ambient" title="CONSYRION AI" />);
    expect(html).toContain('data-electric="off"');
    expect(html).not.toContain("<animate");
    expect(html).not.toContain("consyrion-flow");
    expect(html).toContain('aria-label="CONSYRION AI"');
  });

  it("server-renders the electric logo + name lockup as a readable static outline", () => {
    const html = renderToStaticMarkup(<ElectricLockup label="CONSYRION AI" />);
    expect(html).toContain('aria-label="CONSYRION AI"');
    expect(html).toContain('data-electric="off"');
    expect(html).toContain("CONSYRION");
    expect(html).not.toContain("<animate");
    expect(html).not.toContain("consyrion-flicker");
  });

  it("keeps the favicon and SVG assets in sync with the shared geometry", () => {
    const root = new URL("../../", import.meta.url);
    expect(readFileSync(new URL("src/app/icon.svg", root), "utf8")).toBe(ICON_SVG);
    expect(readFileSync(new URL("public/brand/consyrion-mark.svg", root), "utf8")).toBe(MARK_SVG);
    expect(readFileSync(new URL("public/brand/consyrion-logo.svg", root), "utf8")).toBe(LOGO_SVG);
  });
});

describe("landing page", () => {
  const html = renderToStaticMarkup(<LandingPage signedIn={false} />);

  it("shows the brand, tagline and all seven canonical stages", () => {
    expect(html).toContain("CONSYRION");
    expect(html).toContain("Debate. Decide. Deliver.");
    for (const label of Object.values(COUNCIL_PHASE_LABELS)) expect(html).toContain(label);
  });

  it("leads with the decision and its delivery; the build is optional and unbuilt targets are planned (#163)", () => {
    expect(html).toContain("Your decision, where you work");
    expect(html).toContain("Optional: from verdict to pull request");
    expect(html).toContain("WITH A CONNECTED REPOSITORY");
    expect(html).toContain("PLANNED");
    expect(html).not.toContain(">Build<");
  });

  it("routes every call to action to a real page or section", () => {
    const routes = pageRoutes();
    for (const cta of Object.values(LANDING_CTAS)) {
      expect(html).toContain(cta.label);
      if (cta.href.startsWith("#")) expect(html).toContain(`id="${cta.href.slice(1)}"`);
      else expect(routes).toContain(cta.href);
    }
  });

  it("states BYOK only and labels the hero graphic as an illustration", () => {
    expect(html).toContain("sells no AI credits");
    expect(html).not.toMatch(/buy (ai )?credits/i);
    expect(html).toContain("not live data");
  });

  it("offers the dashboard instead of sign-in to signed-in users", () => {
    const signedIn = renderToStaticMarkup(<LandingPage signedIn />);
    expect(signedIn).toContain('href="/dashboard"');
    expect(signedIn).not.toContain(">Sign in</a></div>");
  });
});

describe("workflow stepper", () => {
  it("derives step states from the real session phase and status", () => {
    expect(stepStatesFor("minority_review", "running")).toMatchObject({ open_council: "completed", minority_review: "running", final_verdict: "pending" });
    expect(stepStatesFor("final_verdict", "awaiting_approval")).toMatchObject({ final_verdict: "completed", execution_council: "pending" });
    expect(stepStatesFor("open_council", "failed")).toMatchObject({ independent_thinking: "completed", open_council: "failed" });
    expect(Object.values(stepStatesFor(null, "queued")).every((s) => s === "pending")).toBe(true);
  });

  it("announces each phase and its state to screen readers", () => {
    const html = renderToStaticMarkup(<WorkflowStepper compact states={stepStatesFor("open_council", "running")} />);
    expect(html).toContain('Open Council<span class="sr-only"> – in progress</span>');
  });
});

describe("council network", () => {
  it("pulses only nodes with a request in flight", () => {
    const html = renderToStaticMarkup(
      <CouncilNetwork
        nodes={[
          { id: "a", label: "Anthropic", state: "working" },
          { id: "b", label: "OpenAI", state: "done" },
          { id: "c", label: "DeepSeek", state: "idle" },
        ]}
      />,
    );
    expect(html.match(/data-pulse="true"/g)).toHaveLength(1);
    expect(html).toContain("Anthropic: working, OpenAI: done, DeepSeek: waiting");
  });

  it("shows no motion at all for an idle council", () => {
    const html = renderToStaticMarkup(<CouncilNetwork nodes={[{ id: "a", label: "Architect", state: "idle" }]} />);
    expect(html).not.toContain("data-pulse");
    expect(html).not.toContain("consyrion-flow");
  });
});

describe("live metric card", () => {
  it("labels fixture numbers as demo data and shows the live dot only when live", () => {
    const demo = renderToStaticMarkup(<LiveMetricCard demo label="Sessions" value={3} />);
    expect(demo).toContain("Demo data");
    expect(demo).not.toContain('data-live="true"');
    const live = renderToStaticMarkup(<LiveMetricCard live label="Running now" value={1} />);
    expect(live).toContain('data-live="true"');
    expect(live).not.toContain("Demo data");
  });

  it("draws a sparkline only from at least two real values", () => {
    expect(renderToStaticMarkup(<LiveMetricCard label="x" value={1} series={{ values: [5], label: "one" }} />)).not.toContain("<polyline");
    expect(renderToStaticMarkup(<LiveMetricCard label="x" value={1} series={{ values: [5, 9], label: "two" }} />)).toContain("<polyline");
  });
});

describe("auth shell", () => {
  it("frames sign-in, sign-up and invitations with the brand and keeps the form content", () => {
    const html = renderToStaticMarkup(
      <AuthShell>
        <form aria-label="Sign in form" />
      </AuthShell>,
    );
    expect(html).toContain('aria-label="CONSYRION AI home"');
    expect(html).toContain("Debate. Decide. Deliver.");
    expect(html).toContain('aria-label="Sign in form"');
    // Always-dark stage with the full-page ribbon canvas, static on the server.
    expect(html).toContain("stage-dark");
    expect(html).toContain('data-ribbons="off"');
  });
});

describe("orbital sign-in logo (#67)", () => {
  const html = renderToStaticMarkup(<ConsyrionOrbitalLogo />);
  it("is decorative, static on the server and has exactly three distributed spheres", () => {
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('data-orbital="off"');
    expect(html.match(/data-planet="/g)).toHaveLength(3);
    // Sphere transforms carry a three-decimal scale; all three start at different places.
    const positions = [...html.matchAll(/transform="translate\(([-\d.]+) ([-\d.]+)\) scale\(\d\.\d{3}\)"/g)].map(
      (m) => `${Math.round(Number(m[1]))},${Math.round(Number(m[2]))}`,
    );
    expect(positions).toHaveLength(3);
    expect(new Set(positions).size).toBe(3);
    expect(html).not.toContain("consyrion-spin-surface");
  });
  it("orbits slowly and continuously, larger on the near side than on the far side", () => {
    expect(orbitAngle(0)).toBe(0);
    expect(orbitAngle(12)).toBeCloseTo(90);
    expect(orbitAngle(48)).toBeCloseTo(360);
    const near = orbitState(90);
    const far = orbitState(-90);
    expect(near.depth).toBeGreaterThan(0);
    expect(far.depth).toBeLessThan(0);
    expect(near.scale).toBeGreaterThan(far.scale);
  });
  it("keeps the brand name outside the decorative SVG on the sign-in page", () => {
    const shell = renderToStaticMarkup(<AuthShell>x</AuthShell>);
    expect(shell).toContain("CONSYRION");
    expect(shell).toContain('aria-label="CONSYRION AI home"');
  });
});

describe("password field", () => {
  it("starts hidden with a labelled, toggleable show button", () => {
    const html = renderToStaticMarkup(<PasswordField label="Password" name="password" />);
    expect(html).toContain('type="password"');
    expect(html).toContain('aria-label="Show password"');
    expect(html).toContain('aria-pressed="false"');
  });
});

describe("dashboard activity network", () => {
  it("animates only links of working models and names every model", () => {
    const html = renderToStaticMarkup(
      <ActivityNetwork
        centerTitle="DECISION"
        centerSubtitle="Running"
        nodes={[
          { id: "a", provider: "openai", model: "gpt-x", state: "working" },
          { id: "b", provider: "anthropic", model: "claude-x", state: "done" },
        ]}
      />,
    );
    expect(html.match(/data-pulse="true"/g)).toHaveLength(1);
    expect(html.match(/consyrion-flow/g)).toHaveLength(1);
    expect(html).toContain("OpenAI gpt-x: Working, Anthropic claude-x: Done");
  });
});

describe("council room voice states", () => {
  const base = {
    session: { currentPhase: "independent_thinking", status: "running" },
    participants: [
      { id: "p1", status: "active" },
      { id: "p2", status: "active" },
      { id: "p3", status: "failed" },
    ],
    usage: [{ participantId: "p1", phase: "independent_thinking", outcome: "ok" }],
  } as unknown as View;
  it("uses the same usage rows as the phase screens and never pulses idle models (#69)", () => {
    expect(voiceStates(base)).toEqual({ p1: "submitted", p2: "working", p3: "failed" });
    expect(voiceStates({ ...base, session: { ...base.session, status: "awaiting_approval" } } as View)).toEqual({
      p1: "submitted",
      p2: "submitted",
      p3: "failed",
    });
  });
  it("never shows queued models as working, and unanswered models of a failed council as waiting (#106)", () => {
    expect(voiceStates({ ...base, session: { ...base.session, status: "queued" }, usage: [] } as unknown as View)).toEqual({
      p1: "waiting",
      p2: "waiting",
      p3: "failed",
    });
    expect(voiceStates({ ...base, session: { ...base.session, status: "failed" } } as View)).toEqual({ p1: "submitted", p2: "waiting", p3: "failed" });
  });
  it("shows a model without a stored vote as not evaluated after the verdict, not as submitted (#151)", () => {
    const done = {
      ...base,
      session: { ...base.session, status: "awaiting_approval" },
      decision: { id: "d1" },
      votes: [{ evaluatorParticipantId: "p1" }],
    } as unknown as View;
    expect(voiceStates(done)).toEqual({ p1: "submitted", p2: "evaluation_failed", p3: "failed" });
  });
  it("shows a model as submitted in the 12 Minds Council only when all its role reviews are in (#175)", () => {
    const minds = {
      ...base,
      session: { currentPhase: "twelve_minds_council", status: "running" },
      usage: [
        { participantId: "p1", phase: "twelve_minds_council", outcome: "ok" },
        { participantId: "p2", phase: "twelve_minds_council", outcome: "ok" },
      ],
      roles: [
        { participantId: "p1", role: "security_expert" },
        { participantId: "p1", role: "cost_analyst" },
        { participantId: "p2", role: "software_architect" },
        { participantId: "p2", role: "backend_engineer" },
      ],
      messages: [
        { phase: "twelve_minds_council", round: 1, participantId: "p1", role: "security_expert", kind: "preference" },
        { phase: "twelve_minds_council", round: 1, participantId: "p2", role: "software_architect", kind: "preference" },
        { phase: "twelve_minds_council", round: 1, participantId: "p2", role: "backend_engineer", kind: "role_failed" },
      ],
      callFailures: [{ participantId: "p2", failed: 8, lastErrorKind: "overloaded", lastHttpStatus: 503 }],
    } as unknown as View;
    // p1: one of two roles still open → working, not submitted; p2: every role settled, one failed.
    expect(voiceStates(minds)).toEqual({ p1: "working", p2: "roles_failed", p3: "failed" });
    expect(failureSummary(minds, "p2")).toBe("8 failed calls · last: overloaded (HTTP 503)");
    expect(failureSummary(minds, "p1")).toBeNull();
  });
  it("counts decided objections while the Minority Review runs (#184)", () => {
    const objections = [{ status: "refuted" }, { status: "unresolved" }, { status: "open" }];
    const review = { ...base, session: { currentPhase: "minority_review", status: "running" }, objections } as unknown as View;
    expect(objectionProgress(review)).toBe("2 of 3 objections decided");
    expect(objectionProgress({ ...review, session: { currentPhase: "minority_review", status: "awaiting_approval" } } as unknown as View)).toBeNull();
    expect(objectionProgress({ ...review, session: { currentPhase: "consensus_round", status: "running" } } as unknown as View)).toBeNull();
  });
});

describe("routes", () => {
  it("exposes the public home and the component gallery", () => {
    const routes = pageRoutes();
    expect(routes).toContain("/");
    expect(routes).toContain("/design");
    expect(existsSync(join(appDir, "icon.svg"))).toBe(true);
  });
});

describe("design follow-ups #79–#83", () => {
  it("shows a designed empty state without any model activity and links the real next step", async () => {
    const { EmptyCouncil } = await import("./dashboard/empty-council");
    const html = renderToStaticMarkup(
      <EmptyCouncil next={{ href: "/settings/providers", icon: "key", title: "Connect your AI keys", text: "x", action: "Connect keys" }} />,
    );
    expect(html).toContain("No council has run yet");
    expect(html).toContain('href="/settings/providers"');
    expect(html).not.toContain("data-node-state");
    expect(html).not.toContain("consyrion-flow");
  });

  it("names every model and its state in text on the compact mobile council card", async () => {
    const { LiveCouncilCompact } = await import("./dashboard/live-council-compact");
    const html = renderToStaticMarkup(
      <LiveCouncilCompact
        href="/sessions/s"
        live
        status="Running"
        project="Demo"
        phase="Independent Thinking"
        phaseLine="1 of 2 submitted"
        used={1200}
        budget={4000}
        nodes={[
          { id: "a", provider: "openai", model: "gpt-x", state: "done" },
          { id: "b", provider: "anthropic", model: "claude-x", state: "working" },
        ]}
      />,
    );
    expect(html).toContain('aria-label="2 independent models"');
    expect(html).toContain("gpt-x");
    expect(html).toContain(">Done<");
    expect(html).toContain(">Working<");
    expect(html).toContain("LIVE COUNCIL");
    expect(html).toContain("1.2K");
  });

  it("groups settings pages under one navigation entry and session pages under Decisions", async () => {
    const { isActive } = await import("./app-shell");
    expect(isActive({ href: "/decisions", also: ["/sessions"] }, "/sessions/ses_1")).toBe(true);
    expect(isActive({ href: "/settings/workspace", also: ["/settings/team"] }, "/settings/team")).toBe(true);
    expect(isActive({ href: "/settings/workspace", also: ["/settings/team"] }, "/settings/providers")).toBe(false);
    expect(isActive({ href: "/projects" }, "/projects-archive")).toBe(false);
  });
});

describe("styled select (all dropdowns)", () => {
  it("renders an accessible listbox button that carries the value into forms", async () => {
    const { Select } = await import("./ui/select");
    const html = renderToStaticMarkup(
      <Select name="provider" defaultValue="kimi" aria-label="Provider">
        <option value="anthropic">Anthropic</option>
        <option value="kimi">Moonshot (Kimi)</option>
      </Select>,
    );
    expect(html).toContain('aria-haspopup="listbox"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('<input type="hidden" name="provider" value="kimi"/>');
    expect(html).toContain("Moonshot (Kimi)");
    expect(html).not.toContain("<select");
  });
});

describe("dashboard activity network interaction", () => {
  it("makes every model a focusable control with a readable label", () => {
    const html = renderToStaticMarkup(
      <ActivityNetwork
        centerTitle="DECISION"
        centerSubtitle="Running"
        nodes={[
          {
            id: "a",
            provider: "openai",
            model: "gpt-x",
            state: "working",
            details: { roles: ["Security Expert"], calls: 3, failedCalls: 0, inputTokens: 1200, outputTokens: 800 },
          },
        ]}
      />,
    );
    expect(html).toContain('role="button"');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('aria-label="OpenAI gpt-x: Working"');
    // The hover card only appears on hover or focus.
    expect(html).not.toContain('role="tooltip"');
  });
});
