import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, type DatabaseHandle } from "../client";
import { user } from "../schema";
import { resolveActor, type ActorContext } from "./context";
import { resolvePlatformAdmin } from "./feedback";
import { blockedOnlyByOneUnconfirmable, requirementIntakeMetrics } from "./intake-metrics";
import { ensurePersonalOrganization } from "./organizations";
import { createProject } from "./projects";
import { confirmRequirementList, proposeRequirementList } from "./requirements";
import { setSubscriptionPlan } from "./saas";

let handle: DatabaseHandle;
let actor: ActorContext;

beforeAll(async () => {
  handle = createDatabase("memory://");
  await handle.migrate();
  await handle.db.insert(user).values([
    { id: "admin", name: "Admin", email: "admin@example.test" },
    { id: "owner", name: "Owner", email: "owner@example.test" },
  ]);
  const org = await ensurePersonalOrganization(handle.db, "owner", "Owner");
  await setSubscriptionPlan(handle.db, "admin", org.id, "business");
  actor = await resolveActor(handle.db, "owner", org.id);
});

afterAll(async () => {
  await handle.close();
});

describe("requirement intake metrics (#245, read-only)", () => {
  it("counts proposed, kept, user-added and split statements of confirmed lists – platform admins only", async () => {
    const project = await createProject(handle.db, actor, {
      name: "Metrics",
      type: "architecture",
      brief: {
        idea: "Ein Bestellportal für 80 Mitarbeiter, das vor allem einfach sein soll.",
        goal: "",
        requirements: "Daten nur in der EU, Verschlüsselung at rest, Audit-Log 5 Jahre.\nBetriebskosten höchstens 400 CHF pro Monat.",
      },
    });
    const proposal = await proposeRequirementList(handle.db, actor, project.id);
    const [first, second] = proposal.items;
    const parts = first!.decomposition?.kind === "split" ? first!.decomposition.parts : [];
    expect(parts).toHaveLength(3);
    await confirmRequirementList(handle.db, actor, project.id, {
      sourceHash: proposal.source.hash,
      items: [
        ...parts.map((text) => ({ text, candidateKey: first!.candidateKey, splitFrom: first!.text })),
        { text: second!.text, candidateKey: second!.candidateKey },
        { text: "Export als CSV." },
      ],
      excluded: proposal.excluded.map((e) => ({ candidateKey: e.candidateKey, reason: e.reason })),
    });

    await expect(requirementIntakeMetrics(handle.db, { userId: "admin", email: "admin@example.test" })).rejects.toThrow(/Not found/);
    const admin = await resolvePlatformAdmin(handle.db, "admin", ["admin@example.test"]);
    const metrics = await requirementIntakeMetrics(handle.db, admin, { days: 30 });
    expect(metrics).toMatchObject({
      days: 30,
      lists: 1,
      kept: 2, // the split statement counts once
      userAdded: 1,
      splitParts: 3,
      proposed: 2 + proposal.excluded.length,
      verdicts: 0,
      onlyOneUnconfirmable: 0,
    });
    // Outside the window nothing is counted.
    expect((await requirementIntakeMetrics(handle.db, admin, { days: 1, now: new Date(Date.now() + 3 * 86_400_000) })).lists).toBe(0);
  });

  it("detects a verdict blocked only by one requirement nobody could confirm", () => {
    const gate = (proposals: unknown[]) => ({ requirementGate: { proposals } });
    const req = (...statuses: string[]) => statuses.map((status, i) => ({ requirementId: `R${i + 1}`, status }));
    expect(blockedOnlyByOneUnconfirmable(gate([{ feasibility: "needs_verification", requirements: req("PASS", "UNKNOWN", "PASS") }]))).toBe(true);
    expect(blockedOnlyByOneUnconfirmable(gate([{ feasibility: "fail", requirements: req("PASS", "FAIL") }]))).toBe(false);
    expect(blockedOnlyByOneUnconfirmable(gate([{ feasibility: "needs_verification", requirements: req("UNKNOWN", "UNKNOWN") }]))).toBe(false);
    // A qualified proposal means the council did not fail at all.
    expect(
      blockedOnlyByOneUnconfirmable(
        gate([
          { feasibility: "qualified", requirements: req("PASS") },
          { feasibility: "needs_verification", requirements: req("UNKNOWN") },
        ]),
      ),
    ).toBe(false);
    expect(blockedOnlyByOneUnconfirmable(null)).toBe(false);
    expect(blockedOnlyByOneUnconfirmable({ proposals: [] })).toBe(false);
  });
});
