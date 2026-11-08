import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { messagesFor } from "../../i18n/all-messages";
import { RequirementIntake, type IntakeProposal } from "../requirement-intake";
import { blockMatches, skillBlockStatuses } from "./skill-block-status";
import { SkillBlocks } from "./skill-blocks";
import { IgnoredFieldsNotice, SkillManager, type SkillRow } from "./skill-manager";
import { SkillPicker } from "./skill-picker";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => undefined, replace: () => undefined }),
  usePathname: () => "/projects/prj/council/new",
}));

const render = (node: ReactNode) =>
  renderToStaticMarkup(
    <NextIntlClientProvider locale="de" messages={messagesFor("de")} timeZone="Europe/Zurich">
      {node}
    </NextIntlClientProvider>,
  );

const rows: SkillRow[] = [
  {
    id: "skl_1",
    name: "Mein Architektur-Check",
    summary: "Eigener Skill",
    category: "architecture",
    visibility: "private",
    version: 2,
    contentHash: "h1",
    editable: true,
    updatedAt: null,
  },
  {
    id: "skl_2",
    name: "Team-Datenschutz",
    summary: "Vom Kollegen",
    category: "data_protection",
    visibility: "team",
    version: 1,
    contentHash: "h2",
    editable: false,
    updatedAt: null,
  },
  {
    id: "official:cost-decision",
    name: "Cost decision",
    summary: "Offiziell",
    category: "cost",
    visibility: "official",
    version: 1,
    contentHash: "h3",
    editable: false,
    updatedAt: null,
  },
];

describe("skills UI (#363 part 2)", () => {
  it("lists own, team and official skills with visibility and the plan limit", () => {
    const html = render(<SkillManager skills={rows} canWrite limits={{ max: 3, own: 1, team: false }} />);
    expect(html).toContain("Deine Skills");
    expect(html).toContain("1 von 3 eigenen Skills");
    expect(html).toContain("Mein Architektur-Check");
    expect(html).toContain(">privat<");
    expect(html).toContain("Team-Datenschutz");
    expect(html).toContain("Offizielle Skills");
    expect(html).toContain("Cost decision");
    // Team sharing needs Pro: the button is there but disabled with the reason.
    expect(html).toContain("Teilen mit dem Team ist in Pro enthalten.");
  });

  it("offers Duplicate for official and team skills, shows the origin of a copy and a version list button (#422)", () => {
    const withCopy: SkillRow[] = [
      { ...rows[0]!, forkedFrom: { skillId: "official:cost-decision", name: "Cost decision", version: 1, contentHash: "h3" } },
      rows[1]!,
      rows[2]!,
    ];
    const html = render(<SkillManager skills={withCopy} canWrite limits={{ max: 3, own: 1, team: false }} />);
    expect(html.match(/>Duplizieren</g)).toHaveLength(2); // team + official, not the own skill
    expect(html).toContain("Kopie von Cost decision (v1)");
    expect(html).toContain(">Versionen<");
    const full = render(<SkillManager skills={rows} canWrite limits={{ max: 1, own: 1, team: false }} />);
    expect([...full.matchAll(/<button[^>]*>Duplizieren<\/button>/g)].every((m) => m[0].includes('disabled=""'))).toBe(true);
  });

  it("blocks new skills at the plan limit", () => {
    const html = render(<SkillManager skills={rows} canWrite limits={{ max: 1, own: 1, team: true }} />);
    expect(html).toContain("Das Limit deines Plans ist erreicht");
  });

  it("shows requirement blocks as proposals with gaps to fill – the add button waits for the values", () => {
    const html = render(
      <SkillBlocks
        skillName="Cost decision"
        blocks={["Recurring cost must not exceed {amount} {currency} per month.", "No gaps here."]}
        onAdd={() => undefined}
      />,
    );
    expect(html).toContain("Bausteine aus dem Skill „Cost decision“");
    expect(html).toContain("Nur Vorschläge");
    expect(html).toContain("amount");
    expect(html).toContain("currency");
    // First block has empty gaps → disabled; second has none → enabled.
    const buttons = [...html.matchAll(/<button[^>]*>Als Anforderung hinzufügen<\/button>/g)].map((m) => m[0]);
    expect(buttons).toHaveLength(2);
    expect(buttons[0]).toContain('disabled=""');
    expect(buttons[1]).not.toContain('disabled=""');
  });

  it("offers the skill blocks inside the requirement intake while editing", () => {
    const proposal: IntakeProposal = {
      source: { hash: "h", briefVersion: 1, documents: [] },
      current: false,
      latest: null,
      items: [],
      excluded: [],
      toDecide: [],
      unscannedDocuments: [],
      notProposed: 0,
    };
    const html = render(
      <RequirementIntake
        projectId="prj"
        proposal={proposal}
        canWrite
        skill={{ name: "Architecture review", blocks: ["Availability must be at least {percent} % per month."] }}
      />,
    );
    expect(html).toContain("Bausteine aus dem Skill „Architecture review“");
  });

  it("names the fields an import or save did not take over (#419)", () => {
    const html = render(<IgnoredFieldsNotice fields={["run", "council.runner"]} />);
    expect(html).toContain("Nicht übernommen: run, council.runner.");
    expect(render(<IgnoredFieldsNotice fields={[]} />)).toBe("");
  });

  it("shows the skill's blocks and their status under a confirmed list without a click (#420)", () => {
    const blocks = [
      "Availability must be at least {percent} % per month.",
      "The p95 response time must be below {milliseconds} ms.",
      "Total monthly infrastructure cost must not exceed {amount} {currency}.",
      "The system must be operable by {team size} developers without a dedicated operations team.",
    ];
    const proposal: IntakeProposal = {
      source: { hash: "h", briefVersion: 1, documents: [] },
      current: true,
      latest: {
        version: 2,
        items: [
          { id: "R1", text: "Availability must be at least 99.9 % per month.", measure: null },
          { id: "R2", text: "Hosting only in Switzerland.", measure: null },
        ],
        excluded: [],
        noHardRequirements: false,
        briefVersion: 1,
        confirmedAt: new Date(0).toISOString(),
      },
      items: [],
      excluded: [],
      toDecide: [],
      unscannedDocuments: [],
      notProposed: 0,
    };
    const html = render(<RequirementIntake projectId="prj" proposal={proposal} canWrite skill={{ name: "Architecture review", blocks }} />);
    expect(html).toContain("Der Skill „Architecture review“ schlägt 4 Bausteine vor – 1 übernommen, 3 offen.");
    expect(html).toContain("Bausteine ansehen");
    // The confirmed list is shown as it is: no block was added to it.
    expect(html).toContain("Hosting only in Switzerland.");
    expect(html).not.toContain("The p95 response time");
  });

  it("matches a filled block, keeps dismissed blocks apart and never adopts without a matching requirement (#420)", () => {
    expect(blockMatches("Availability must be at least {percent} % per month.", "availability must be at least 99.95 % per month")).toBe(true);
    expect(blockMatches("Availability must be at least {percent} % per month.", "Availability must be at least {percent} % per month.")).toBe(false);
    expect(blockMatches("Data must be encrypted in transit and at rest.", "Data must be encrypted in transit.")).toBe(false);
    expect(blockMatches("Cost (CHF) below {amount}.", "Cost (CHF) below 500.")).toBe(true);
    const blocks = ["A {x}.", "B.", "C."];
    expect(skillBlockStatuses(blocks, ["A 1."], new Set(["C."]))).toEqual(["adopted", "open", "dismissed"]);
    expect(skillBlockStatuses(blocks, [], new Set())).toEqual(["open", "open", "open"]);
  });

  it("names the chosen skill in the picker", () => {
    const html = render(<SkillPicker value="official:cost-decision" options={[{ id: "official:cost-decision", name: "Cost decision", group: "official" }]} />);
    expect(html).toContain("Skill verwenden");
    expect(html).toContain("Cost decision");
  });
});
