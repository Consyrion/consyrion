import { NextIntlClientProvider } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import de from "../../../messages/de.json";
import type { View } from "./helpers";
import { canIntervene, CouncilQuestions, interventionCounts, ObjectionInterventions } from "./human-questions";

const answer = (id: string, body: string, error: string | null = null) => ({
  id,
  interventionId: "hiv_1",
  organizationId: "org",
  participantId: "par_a",
  modelId: "model-a",
  body,
  error,
  inputTokens: 10,
  outputTokens: 5,
  createdAt: "2026-11-09T10:00:00Z",
});

function view(status: string, projectStatus = "ready"): View {
  return {
    session: { id: "ses_1", status },
    project: { status: projectStatus },
    participants: [{ id: "par_a", modelId: "model-a" }],
    interventions: [
      { id: "hiv_1", kind: "question", targetType: "session", targetId: null, text: "Was kostet B?", answers: [answer("a1", "Etwa 20 €."), answer("a2", "", "openai timeout")] },
      { id: "hiv_2", kind: "statement_request", targetType: "objection", targetId: "obj_1", text: "", answers: [answer("a3", "Ein Backup reicht.")] },
      { id: "hiv_3", kind: "mark", targetType: "objection", targetId: "obj_1", text: "", answers: [] },
    ],
  } as unknown as View;
}

const html = (node: React.ReactNode) =>
  renderToStaticMarkup(
    <NextIntlClientProvider locale="de" messages={de}>
      {node}
    </NextIntlClientProvider>,
  );

describe("human questions after the verdict (#15/#41 stage 1)", () => {
  it("marks every answer as a human's question without effect, shows failures, and offers asking only to deciders", () => {
    const out = html(<CouncilQuestions view={view("awaiting_approval")} canApprove />);
    expect(out).toContain("Rückfrage des Menschen");
    expect(out).toContain("ohne Einfluss auf Urteil und Prüfungen");
    expect(out).toContain("Etwa 20 €.");
    expect(out).toContain("keine Antwort (openai timeout)");
    expect(out).toContain("Kosten prüfen");
    // A viewer sees the answers but cannot ask.
    expect(html(<CouncilQuestions view={view("awaiting_approval")} canApprove={false} />)).not.toContain("Kosten prüfen");
  });

  it("offers nothing while the council runs or in an archived project", () => {
    expect(canIntervene(view("running"), true)).toBe(false);
    expect(canIntervene(view("awaiting_approval", "archived"), true)).toBe(false);
    expect(canIntervene(view("approved"), true)).toBe(true);
    const running = html(<ObjectionInterventions view={view("running")} objectionId="obj_1" canApprove />);
    expect(running).not.toContain("Stellungnahme anfordern");
    expect(running).toContain("Ein Backup reicht."); // earlier answers stay visible
  });

  it("shows the statement and the mark on the objection, and counts for the key disputes without ranking", () => {
    const out = html(<ObjectionInterventions view={view("awaiting_approval")} objectionId="obj_1" canApprove />);
    expect(out).toContain("Als wichtig markiert");
    expect(out).toContain("Stellungnahme anfordern");
    expect(out).toContain("Ein Backup reicht.");
    expect(interventionCounts(view("awaiting_approval"))).toEqual({ questions: 2, marks: 1 });
  });
});
