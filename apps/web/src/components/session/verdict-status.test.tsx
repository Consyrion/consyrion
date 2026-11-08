import { NextIntlClientProvider } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { messagesFor } from "../../i18n/all-messages";
import type { View } from "./helpers";
import { EvaluationScreen, VerdictScreen } from "./screens";

// The Final Verdict screen only displays the server's decisionStatus (#181, stage 1); it never re-checks the format.
function view(outcome: string, status: Record<string, unknown>, matrix: Record<string, unknown> = { proposals: [] }): View {
  return {
    session: { id: "s1", status: "awaiting_approval" },
    project: { id: "p", name: "Test", deliveryDefault: null },
    participants: [],
    proposals: [],
    objections: [],
    scores: [],
    votes: [],
    approvals: [],
    previousDecisions: [],
    usage: [],
    participation: null,
    consensus: null,
    decision: { id: "d1", outcome, recommendedProposalId: null, matrix, gateVersion: 1 },
    decisionStatus: { gateVersion: 1, readable: true, approvable: true, reason: null, canApproveRecommendation: false, approvableProposalIds: [], ...status },
  } as unknown as View;
}

const render = (v: View) =>
  renderToStaticMarkup(
    <NextIntlClientProvider locale="en" messages={messagesFor("en")}>
      <VerdictScreen view={v} canApprove onChange={async () => {}} />
    </NextIntlClientProvider>,
  );

describe("Final Verdict with outcomes the gate does not approve (#181, stage 1)", () => {
  it("#249 part 2: favourite/prototype mark, self-declared measurements and the new actions – shown, never an approval", () => {
    const matrix = {
      proposals: [],
      requirementGate: {
        comparisonComplete: true,
        comparisonNote: null,
        summary: null,
        proposals: [
          {
            proposalId: "A",
            feasibility: "needs_verification",
            architectureCandidate: true,
            limitedReview: false,
            causes: [],
            requirements: [
              { requirementId: "R1", status: "PASS", measurementPending: true, pass: ["e1", "e2"], fail: [], unknown: [], open: [], conflicts: [] },
            ],
          },
        ],
      },
    };
    const v = view(
      "needs_verification",
      {
        gateVersion: 3,
        approvable: false,
        reason: "Architecture candidate – performance proof open: x",
        prototypeProposalIds: ["A"],
        measurementApprovableProposalIds: [],
      },
      matrix,
    ) as unknown as Record<string, unknown>;
    v.proposals = [
      {
        id: "A",
        label: "A",
        kind: "original",
        revisions: [{ id: "r1", proposalId: "A", version: 1, content: { title: "Mesh", summary: "", architecture: "P2P mesh", components: ["relay"] } }],
        authorParticipantId: null,
        architectureChange: null,
      },
    ];
    v.requirementList = { version: 1, items: [{ id: "R1", text: "Rhythmisch stabiles Zusammenspiel" }], excluded: [] };
    v.humanMark = { kind: "prototype_build", proposalId: "A", comment: "Measure jitter", createdAt: new Date(0).toISOString() };
    v.measurements = [
      {
        id: "m1",
        decisionId: "d1",
        proposalId: "A",
        requirementId: "R1",
        planId: null,
        method: "Loopback",
        target: "≤ 25 ms",
        measured: "18 ms",
        met: true,
        evidence: "Log 10.11.",
        recordedBy: "Owner",
        createdAt: new Date(0).toISOString(),
      },
    ];
    const html = renderToStaticMarkup(
      <NextIntlClientProvider locale="de" messages={messagesFor("de")} timeZone="Europe/Zurich">
        <VerdictScreen view={v as unknown as View} canApprove onChange={async () => {}} />
      </NextIntlClientProvider>,
    );
    expect(html).toContain("Prototyp-/Mess-Build freigegeben – keine fertige Lösung und keine reguläre Freigabe");
    expect(html).toContain("Abnahme durch Messung");
    expect(html).toContain("Messung: Selbstauskunft von Owner, Beleg: Log 10.11.");
    // The designed select renders only the chosen option: #511 preselects "mark as favourite" – still no approval.
    expect(html).toContain("Als Favorit markieren (keine Freigabe, kein Build)");
  });

  it("#249 part 2: an architecture candidate is named as such, with the measurement plan marked and no approval", () => {
    const matrix = {
      proposals: [],
      requirementGate: {
        comparisonComplete: true,
        comparisonNote: null,
        summary: null,
        proposals: [
          {
            proposalId: "A",
            feasibility: "needs_verification",
            architectureCandidate: true,
            limitedReview: false,
            causes: [
              "Architecture candidate – performance proof open: R1 can only be confirmed by measuring the running implementation; the evaluators confirmed the measurement plan, not the requirement.",
            ],
            requirements: [
              { requirementId: "R1", status: "PASS", measurementPending: true, pass: ["e1", "e2"], fail: [], unknown: [], open: [], conflicts: [] },
            ],
          },
        ],
      },
    };
    const html = render(
      view(
        "needs_verification",
        {
          gateVersion: 3,
          approvable: false,
          reason: "Architecture candidate – performance proof open: a requirement can only be confirmed by measuring the running implementation.",
        },
        matrix,
      ),
    );
    expect(html).toContain("Architecture candidate – performance proof open, not approvable");
    expect(html).not.toContain("Recommended solution");
    // Version 3 shares the S1 locks: no extra debate, the way on is a changed brief.
    expect(html).toContain('<span class="min-w-0 truncate">Request changes – then edit the brief or requirements and start a new council</span>');
    const de = renderToStaticMarkup(
      <NextIntlClientProvider locale="de" messages={messagesFor("de")}>
        <VerdictScreen
          view={view("needs_verification", { gateVersion: 3, approvable: false, reason: "Architecture candidate – performance proof open: R1 can only be confirmed by measuring the running implementation." }, matrix)}
          canApprove
          onChange={async () => {}}
        />
      </NextIntlClientProvider>,
    );
    expect(de).toContain("Architektur-Kandidat – Leistungsnachweis offen, nicht freigebbar");
    // #511: the reason names the open measurement requirement.
    expect(de).toContain("Architektur-Kandidat – Leistungsnachweis offen: R1 lässt sich nur durch Messung");
  });

  it("shows needs_verification neutrally and offers no approval", () => {
    const html = render(
      view("needs_verification", { approvable: false, reason: "Needs verification – the council could not confirm that a proposal meets every requirement." }),
    );
    expect(html).toContain("Needs verification – not approvable");
    expect(html).toContain('data-testid="not-approvable-reason"');
    expect(html).not.toContain("No solution can meet these requirements");
    // The preselected action is a non-approval; approve and select_alternative are disabled in the same flag.
    expect(html).toContain('<span class="min-w-0 truncate">Request changes</span>');
  });

  it("an unknown outcome or gate version is 'not approvable', never shown as a recommendation", () => {
    const unknown = render(view("qualified", { approvable: false, reason: "This verdict uses a result this version does not know." }));
    expect(unknown).toContain("Not approvable");
    expect(unknown).not.toContain("Recommended solution");
    expect(unknown).toContain('<span class="min-w-0 truncate">Request changes</span>');
    const newer = view(
      "recommended",
      { gateVersion: 4, readable: false, approvable: false, reason: "This verdict was computed with gate version 4, which this version does not support." },
      { somethingElse: true },
    );
    const html = render(newer);
    expect(html).toContain("gate version 4");
    expect(html).not.toContain("Recommended solution");
    expect(html).toContain('<span class="min-w-0 truncate">Request changes</span>');
    // The evaluation screen does not try to read a matrix it does not know.
    expect(
      renderToStaticMarkup(
        <NextIntlClientProvider locale="en" messages={messagesFor("en")}>
          <EvaluationScreen view={newer} />
        </NextIntlClientProvider>,
      ),
    ).toContain("Evaluation not shown");
  });

  it("a legacy version-1 recommendation stays approvable when the server says so", () => {
    const html = render(view("recommended", { canApproveRecommendation: true }));
    expect(html).toContain("Recommended solution");
    expect(html).toContain('<span class="min-w-0 truncate">Approve recommendation</span>');
  });
});

describe("Final Verdict and evaluation of the S1 gate (#181, gate version 2)", () => {
  const gate = {
    proposals: [
      {
        proposalId: "pA",
        feasibility: "needs_verification",
        causes: ["R1 not confirmed: 1 of 2 evaluators could not confirm it."],
        requirements: [{ requirementId: "R1", status: "UNKNOWN", pass: ["e1"], fail: [], unknown: ["e2"], open: [], conflicts: [] }],
      },
    ],
    comparisonComplete: true,
    comparisonNote: null,
    summary: "None of the evaluated proposals meets all confirmed requirements according to these evaluations.",
  };
  const v2 = () => {
    const v = view(
      "needs_verification",
      { gateVersion: 2, approvable: false, reason: "Needs verification – the council could not confirm that a proposal meets every requirement." },
      { proposals: [], requirementGate: gate, weights: {}, formula: "", majorityVoteWinnerId: null },
    ) as unknown as Record<string, unknown>;
    v.proposals = [{ id: "pA", label: "A", revisions: [{ version: 1, content: { title: "Monolith" } }] }];
    v.requirementList = { id: "l1", version: 1, items: [{ id: "R1", text: "Health data stays in Germany." }], excluded: [] };
    v.requirementChecks = [
      {
        id: "c1",
        evaluatorParticipantId: "e2",
        proposalId: "pA",
        requirementId: "R1",
        status: "PASS",
        allPartsMet: false,
        evidence: "EU hosting",
        valid: true,
        invalidReason: null,
      },
    ];
    return v as unknown as View;
  };

  it("offers no extra debate, names the cause per proposal and never claims the requirements cannot be met", () => {
    const html = render(v2());
    expect(html).not.toContain("Request more debate");
    expect(html).toContain("start a new council");
    expect(html).toContain("Proposal A: needs verification");
    expect(html).toContain("None of the evaluated proposals meets all confirmed requirements according to these evaluations.");
    expect(html).not.toContain("No solution can meet these requirements");
  });

  it("shows status, who said what and the evidence per requirement, labelled as model judgements", () => {
    const html = renderToStaticMarkup(
      <NextIntlClientProvider locale="en" messages={messagesFor("en")}>
        <EvaluationScreen view={v2()} />
      </NextIntlClientProvider>,
    );
    expect(html).toContain("Confirmed requirements per proposal");
    expect(html).toContain("not an independent fact check");
    expect(html).toContain("Health data stays in Germany.");
    expect(html).toContain("(not every part confirmed)");
  });
});

describe("#230: the Final Verdict says first why there is no recommendation", () => {
  // The first GPT-1 run (30.10.26): DeepSeek's evaluation was lost, nothing was found unmet.
  const lost = {
    proposals: [],
    failedEvaluators: [{ participantId: "par_d", modelId: "deepseek-flash", outcome: "max_tokens" }],
    requirementGate: {
      summary:
        "None of the 3 evaluated proposals could be confirmed against all requirements: the evaluations leave requirements open. Not confirmed is not the same as not met.",
      comparisonNote: null,
      proposals: [
        { proposalId: "a", feasibility: "needs_verification", causes: [], requirements: [] },
        { proposalId: "b", feasibility: "needs_verification", causes: [], requirements: [] },
        { proposalId: "c", feasibility: "qualified", causes: [], requirements: [] },
      ],
    },
  };

  it("a lost evaluation is named as a technical gap with the next step, and 'Repeat the evaluation' is preselected", () => {
    const html = render(view("needs_verification", { gateVersion: 2, approvable: false, reason: "Needs verification." }, lost));
    expect(html).toContain('data-testid="main-reason"');
    expect(html).toContain("Main reason: the evaluation is incomplete.");
    expect(html).toContain("deepseek-flash (answer was cut off at the output limit) could not finish its check, so 2 proposals could not be confirmed");
    expect(html).toContain("not a finding that a proposal fails a requirement");
    expect(html).toContain('<span class="min-w-0 truncate">Repeat the evaluation (1 model without scores)</span>');
  });

  it("without a lost evaluation there is no technical main reason, and 'no qualifying solution' speaks about these proposals only", () => {
    const html = render(view("no_qualifying_solution", { gateVersion: 2 }, { ...lost, failedEvaluators: [] }));
    expect(html).not.toContain("main-reason");
    expect(html).toContain("None of the proposals meets the requirements");
    expect(html).not.toContain("No solution meets the requirements");
  });
});

describe("#230: violated, disputed and not proven are told apart, with the next step that exists", () => {
  const matrix = {
    proposals: [],
    requirementGate: {
      summary: null,
      comparisonNote: null,
      comparisonComplete: true,
      proposals: [
        {
          proposalId: "pA",
          feasibility: "fail",
          causes: [],
          requirements: [{ requirementId: "q1", status: "FAIL", pass: [], fail: ["e1", "e2"], unknown: [], open: [], conflicts: [] }],
        },
        {
          proposalId: "pB",
          feasibility: "needs_verification",
          causes: [],
          requirements: [{ requirementId: "q2", status: "UNKNOWN", pass: ["e1"], fail: [], unknown: ["e3"], open: [], conflicts: [] }],
        },
      ],
    },
  };
  const make = (locale: "en" | "de") => {
    const v = view("no_qualifying_solution", { gateVersion: 2 }, matrix) as unknown as Record<string, unknown>;
    v.proposals = [
      { id: "pA", label: "A", revisions: [{ version: 1, content: { title: "Monolith" } }] },
      { id: "pB", label: "B", revisions: [{ version: 1, content: { title: "Serverless" } }] },
    ];
    v.requirementList = {
      id: "l1",
      version: 1,
      items: [
        { id: "q1", text: "Ready in 4 weeks" },
        { id: "q2", text: "99.9 % uptime" },
      ],
      excluded: [],
    };
    return renderToStaticMarkup(
      <NextIntlClientProvider locale={locale} messages={messagesFor(locale)}>
        <VerdictScreen view={v as unknown as View} canApprove onChange={async () => {}} />
      </NextIntlClientProvider>,
    );
  };

  it("says per proposal what is wrong in plain words and what to do next", () => {
    const html = make("en");
    expect(html).toContain('data-testid="why-no-recommendation"');
    expect(html).toContain("Proposal A: R1 not met – 2 of 2 AI evaluators say so.");
    expect(html).toContain("Proposal B: R2 could not be confirmed from the proposal text. Not confirmed is not the same as not met");
    expect(html).toContain("it does not mean that no solution exists at all");
    expect(html).toContain("Add the missing facts to the brief");
    expect(html).toContain("Check whether the violated requirement is really a hard requirement");
    // Nothing is offered that does not exist yet.
    expect(html).not.toMatch(/re-check|nachprüf/i);
  });

  it("speaks German in the German interface", () => {
    const html = make("de");
    expect(html).toContain("Warum es keine freigebbare Empfehlung gibt");
    expect(html).toContain("R1 nicht erfüllt – das sagen 2 von 2 KI-Bewertern.");
  });
});

describe("the server's English reason in the interface language (QA 07.11.26)", () => {
  it("shows the known needs_verification reason in German", () => {
    const html = renderToStaticMarkup(
      <NextIntlClientProvider locale="de" messages={messagesFor("de")}>
        <VerdictScreen
          view={view("needs_verification", {
            approvable: false,
            reason: "Needs verification – the council could not confirm that a proposal meets every requirement.",
          })}
          canApprove
          onChange={async () => {}}
        />
      </NextIntlClientProvider>,
    );
    expect(html).toContain("Prüfung nötig – der Council konnte nicht bestätigen");
    expect(html).not.toContain("the council could not confirm");
  });
});

describe("conflict of interest withholds the recommendation (night test 07.11.26)", () => {
  it("says that the qualified proposal meets every requirement instead of 'could not confirm'", () => {
    const v = view(
      "needs_verification",
      { approvable: false, reason: "Needs verification – the council could not confirm that a proposal meets every requirement." },
      { proposals: [], confidenceIssues: [{ kind: "conflict_of_interest", proposalId: "p2", blockedProposalId: "p3" }] },
    );
    (v as unknown as { proposals: unknown[] }).proposals = [
      { id: "p2", label: "2", kind: "standard", authorParticipantId: "a", revisions: [{ version: 1, content: { title: "B" } }] },
      { id: "p3", label: "3", kind: "standard", authorParticipantId: "b", revisions: [{ version: 1, content: { title: "B" } }] },
    ];
    const html = renderToStaticMarkup(
      <NextIntlClientProvider locale="de" messages={messagesFor("de")}>
        <VerdictScreen view={v} canApprove onChange={async () => {}} />
      </NextIntlClientProvider>,
    );
    expect(html).toContain("Vorschlag 2 erfüllt alle Anforderungen, wird aber nicht automatisch empfohlen");
    expect(html).not.toContain("konnte nicht bestätigen");
  });
});
