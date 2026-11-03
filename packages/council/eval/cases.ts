/**
 * Golden cases for the council engine (#33). Each case runs the real engine end to end with deterministic
 * test models (see test/scripted-adapter.ts) and states the properties the outcome must have. They are
 * regression guards for the decision logic – not a measure of real model quality (see eval/README.md).
 */
import type { DecisionMode } from "@consyrion/core";
import type { Script } from "../test/scripted-adapter";

export interface GoldenCase {
  id: string;
  description: string;
  mode: DecisionMode;
  models: Record<string, Script>;
  expect: {
    outcome?: "recommended" | "tie" | "no_qualifying_solution" | "insufficient_evidence";
    /** Title of the proposal that must be recommended. */
    winner?: string;
    /** Title of a proposal that must NOT be recommended. */
    notWinner?: string;
    confidence?: "normal" | "low";
    /** At least one blocking objection against this proposal title. */
    blockedTitle?: string;
    /** Failed participants (model ids). */
    failed?: string[];
  };
}

const scoreFor = (best: string, high = 9, low = 6) => (title: string) => (title === best ? high : low);
const preferTitle = (wanted: string) => (labels: string[], _own: string, prompt: string) =>
  labels.find((l) => prompt.split(`<proposal label="${l}">`)[1]?.includes(`"title": "${wanted}"`)) ?? labels[0]!;

export const GOLDEN_CASES: GoldenCase[] = [
  {
    id: "clear-winner",
    description: "All independent evaluators rate one proposal clearly highest → it is recommended with normal confidence.",
    mode: "independent_expert",
    models: {
      m1: { title: "Modular monolith", score: scoreFor("Modular monolith") },
      m2: { title: "Microservices", score: scoreFor("Modular monolith") },
      m3: { title: "Serverless", score: scoreFor("Modular monolith") },
    },
    expect: { outcome: "recommended", winner: "Modular monolith", confidence: "normal" },
  },
  {
    id: "no-self-vote",
    description: "Every model rates its own proposal 10 and others 5; self-scores are ignored, so no model can win by voting for itself.",
    mode: "independent_expert",
    models: {
      m1: { title: "A-plan", score: (t) => (t === "A-plan" ? 10 : t === "C-plan" ? 8 : 5) },
      m2: { title: "B-plan", score: (t) => (t === "B-plan" ? 10 : t === "C-plan" ? 8 : 5) },
      m3: { title: "C-plan", score: (t) => (t === "C-plan" ? 10 : 6) },
    },
    expect: { outcome: "recommended", winner: "C-plan" },
  },
  {
    id: "tie",
    description: "Two proposals receive identical independent scores → reported as a tie, the human chooses.",
    mode: "independent_expert",
    models: {
      m1: { title: "Left", score: () => 8 },
      m2: { title: "Right", score: () => 8 },
    },
    expect: { outcome: "tie" },
  },
  {
    id: "minority-blocks-majority",
    description: "The majority favours a proposal, one model proves a critical security risk and an independent judge accepts it → the favourite cannot be recommended (11:1 principle).",
    mode: "adversarial_review",
    models: {
      m1: { title: "Monolith", prefer: preferTitle("Monolith"), score: scoreFor("Monolith", 9, 7) },
      m2: { title: "Microservices", prefer: preferTitle("Monolith"), adjudicate: () => "accepted", score: scoreFor("Monolith", 9, 7) },
      m3: {
        title: "Serverless",
        prefer: (labels, own, prompt) => labels.find((l) => prompt.split(`<proposal label="${l}">`)[1]?.includes(`"title": "${own}"`))!,
        critiques: [{ againstTitle: "Monolith", claim: "Tokens stored in plain text", category: "security", severity: "critical" }],
        adjudicate: () => "accepted",
        score: scoreFor("Monolith", 9, 7),
      },
    },
    expect: { notWinner: "Monolith", blockedTitle: "Monolith" },
  },
  {
    id: "missing-evaluator",
    description: "One model never returns a valid evaluation → the verdict is flagged low confidence instead of resting silently on fewer scores.",
    mode: "independent_expert",
    models: {
      m1: { title: "Alpha", score: scoreFor("Alpha") },
      m2: { title: "Beta", score: scoreFor("Alpha") },
      m3: { title: "Gamma", invalidEvaluations: Number.POSITIVE_INFINITY },
    },
    expect: { confidence: "low" },
  },
  {
    id: "failed-model",
    description: "One model fails completely → the council continues with the others and records the failure honestly.",
    mode: "consensus",
    models: {
      m1: { title: "Queue", score: scoreFor("Queue") },
      m2: { title: "Cron", score: scoreFor("Queue") },
      m3: { title: "Broken", fail: true },
    },
    expect: { winner: "Queue", failed: ["m3"] },
  },
];
