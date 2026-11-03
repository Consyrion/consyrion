import type { CouncilPhase } from "@consyrion/core";

export interface StoryChapter {
  /** Anchor id – chapters can be opened directly. */
  id: string;
  /** Canonical phase, when the chapter is one of the seven council phases. */
  phase?: CouncilPhase;
  kicker: string;
  title: string;
  text: string;
  points?: string[];
  /** The running example (one question through the whole story), clearly marked as an example. */
  example?: string;
}

/** The example question that runs through every chapter. */
export const EXAMPLE_QUESTION = "Which database architecture should our SaaS product use?";

/**
 * The homepage scroll story (#85, storyboard in docs/design/homepage-story.md): preparation, the seven canonical
 * phases with their exact names, the human approval gate and the optional build (only with a connected repository, #163). One chapter per scene of
 * `story-scene.ts`; the index of a chapter is its scene key.
 */
export const STORY_CHAPTERS: StoryChapter[] = [
  {
    id: "top",
    kicker: "CONSYRION AI",
    title: "Debate. Decide. Deliver.",
    text: "Several AI models think independently, challenge each other and reach a documented verdict with evidence. You approve – and take the decision where you work: as a report, in your tools or, with a connected GitHub repository, as a reviewed pull request.",
  },
  {
    id: "prepare",
    kicker: "Before the council",
    title: "Your question becomes a brief",
    text: "Create a project and describe the decision. Choose the models and up to twelve perspectives. You connect your own provider keys and set a hard token budget – CONSYRION AI sells no AI credits.",
    example: "Question: “Which database architecture should our SaaS product use?” – three models, twelve perspectives, a budget on your own keys.",
    points: ["Project, question and context", "Models and perspectives you pick", "Your own API keys, your budget"],
  },
  {
    id: "independent-thinking",
    phase: "independent_thinking",
    kicker: "Phase 1",
    title: "Independent Thinking",
    text: "Every model receives the identical brief and works on its own. Answers stay sealed until all are in – no model can see or copy another.",
    example: "Model A drafts a managed multi-tenant database, B a self-hosted cluster, C a hybrid – none of them sees the others.",
  },
  {
    id: "open-council",
    phase: "open_council",
    kicker: "Phase 2",
    title: "Open Council",
    text: "All proposals are revealed at once and laid out side by side as equals. You compare the alternatives while the models ask each other precise questions.",
    example: "Side by side: A is fastest to launch, B gives the most control, C balances both. B asks A how tenants are kept apart.",
  },
  {
    id: "twelve-minds",
    phase: "twelve_minds_council",
    kicker: "Phase 3",
    title: "12 Minds Council",
    text: "Roles such as architecture, security, cost and critic unfold around the models and test every proposal. Twelve perspectives are roles – not twelve extra models or votes.",
    example: "The security role checks tenant isolation, the cost role compares running costs, the critic looks for weak spots.",
  },
  {
    id: "minority-review",
    phase: "minority_review",
    kicker: "Phase 4",
    title: "Minority Review",
    text: "A substantiated objection is highlighted and checked against evidence by independent models. Dissent is recorded – never smoothed away.",
    example: "One objection stands out: in A, a misconfiguration could let tenants see each other’s data. Evidence: test results and provider docs.",
  },
  {
    id: "consensus-round",
    phase: "consensus_round",
    kicker: "Phase 5",
    title: "Consensus Round",
    text: "Authors revise their proposals against the objections; compatible ideas can merge into a hybrid option. Differences that remain stay documented.",
    example: "A adds per-tenant keys and merges with C into “Hybrid A + C”. B’s cost concern stays documented.",
  },
  {
    id: "final-verdict",
    phase: "final_verdict",
    kicker: "Phase 6",
    title: "Final Verdict",
    text: "Recommendation, independent scores, evidence and the minority position come together in one decision report. Nothing is built at this point.",
    example: "Recommendation: Hybrid A + C – with scores for security, cost and time to launch, and the security objection on record.",
  },
  {
    id: "approval",
    kicker: "Human approval",
    title: "You decide",
    text: "Approve, choose an alternative, ask for more debate, request changes or reject. A proposal with an open critical security objection cannot be approved. Without your approval nothing is built.",
    example: "You approve Hybrid A + C – or ask for one more round on cost first.",
  },
  {
    id: "build",
    phase: "execution_council",
    kicker: "Phase 7 · optional, with GitHub",
    title: "Execution Council",
    text: "Only if you want it and a GitHub repository is connected: after your approval the decision becomes tasks, code in an isolated sandbox, tests and independent reviews – delivered as a draft pull request. Most decisions need no build; merge and deployment stay your separate decisions.",
    example: "Tasks: schema, per-tenant keys, migration tests – opened as a draft pull request in your repository.",
  },
  {
    id: "start",
    kicker: "From question to decision",
    title: "From your question to a reasoned decision – delivered where you work, optionally all the way to reviewed code.",
    text: "Your keys, your providers, your approval. Every step leaves evidence you can follow.",
  },
];
