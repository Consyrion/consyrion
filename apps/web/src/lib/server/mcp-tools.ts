import "server-only";
import { createAdapter, ProviderError, timeoutSignal } from "@consyrion/ai";
import { createSession, getSessionView, previewSession, type SessionInput } from "@consyrion/council";
import { DECISION_MODES, DomainError } from "@consyrion/core";
import {
  archiveProject,
  assertClientDailyTokenBudget,
  recordClientCouncilStart,
  createProjectForDecisionRequest,
  decryptCredentialForUse,
  getSkillForUse,
  lastCouncilParticipants,
  latestRequirementList,
  listCredentials,
  listSkills,
  runActionForClient,
  type ActorContext,
  type ApiTokenScope,
  type Database,
} from "@consyrion/db";
import { assistantTools } from "./assistant-tools";
import { decisionBrief } from "./decision-brief";
import { getKeyring } from "./keyring";
import type { McpTool } from "./mcp";
import { modelCatalog, rememberModels } from "./model-catalog";
import { rateLimit } from "./rate-limit";

/** Upper limit for a council started over MCP – lower than the app's maximum, so a client cannot spend unexpectedly. */
export const MCP_MAX_TOKEN_BUDGET = 1_000_000;

/**
 * Upper bound of council token budgets one user may start over MCP per 24 hours (#405), default 5,000,000;
 * operators can change it with MCP_DAILY_TOKEN_BUDGET.
 */
export function mcpDailyTokenBudget(env: Record<string, string | undefined> = process.env): number {
  const configured = Number(env.MCP_DAILY_TOKEN_BUDGET);
  return Number.isInteger(configured) && configured > 0 ? configured : 5_000_000;
}

const str = (description: string) => ({ type: "string", description });
const PROJECT_TYPES = ["idea", "architecture", "repository", "business", "technology_choice"];
const participants = {
  type: "array",
  minItems: 2,
  maxItems: 6,
  description: "2–6 models from list_models: credentialId + modelId each (one model per key/provider combination).",
  items: {
    type: "object",
    properties: { credentialId: str("Key id from list_models"), modelId: str("Model id from list_models") },
    required: ["credentialId", "modelId"],
    additionalProperties: false,
  },
};
const councilInput = (withBudget: boolean) => ({
  type: "object",
  properties: {
    projectId: str("Project id (prj_…)"),
    mode: { type: "string", enum: [...DECISION_MODES], description: "independent_expert, adversarial_review or consensus" },
    participants,
    tokenBudget: {
      type: "integer",
      minimum: 10_000,
      maximum: MCP_MAX_TOKEN_BUDGET,
      description: `Upper token limit of the whole council (max ${MCP_MAX_TOKEN_BUDGET.toLocaleString("en-US")})`,
    },
    ...(withBudget
      ? { confirmBudget: { type: "boolean", description: "Set true only after the user accepted that phases may be shortened to stay within the budget" } }
      : {}),
  },
  required: withBudget ? ["projectId", "mode", "participants", "tokenBudget"] : ["projectId", "mode", "participants"],
  additionalProperties: false,
});

function sessionInput(args: Record<string, unknown>, extra: Partial<SessionInput> = {}): SessionInput {
  return {
    mode: args.mode as SessionInput["mode"],
    participants: Array.isArray(args.participants) ? (args.participants as SessionInput["participants"]) : [],
    tokenBudget: typeof args.tokenBudget === "number" ? args.tokenBudget : undefined,
    confirmBudget: args.confirmBudget === true ? true : undefined,
    ...extra,
  };
}

/**
 * Tools of the CONSYRION MCP server. Each runs with the token owner's actor and the same repository functions as the
 * app – the token sees exactly its workspace. Read-only tokens get only the read tools. Never offered: approve/reject,
 * build, delete, keys, billing, settings, members, confirming requirements – those stay human steps in the app.
 */
export function mcpTools(db: Database, actor: ActorContext, scope: ApiTokenScope, origin: string): McpTool[] {
  const assistant = new Map(assistantTools(db, actor).map((t) => [t.name, t]));
  const read = (name: string, args: Record<string, unknown>) =>
    assistant
      .get(name)!
      .run(args)
      .then((r) => r.data);
  const abs = (href: string) => `${origin}${href}`;

  const tools: McpTool[] = [
    {
      name: "list_projects",
      title: "List projects",
      description: "All projects of the workspace with id, name, type and status.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      write: false,
      run: () => read("list_projects", {}),
    },
    {
      name: "list_decisions",
      title: "List decisions",
      description: "Council sessions (decisions), newest first, with status, phase and tokens. Optional filter by status or project.",
      inputSchema: {
        type: "object",
        properties: {
          status: { type: "string", enum: ["queued", "running", "awaiting_approval", "approved", "rejected", "failed", "cancelled"] },
          projectId: str("Project id (prj_…)"),
        },
        additionalProperties: false,
      },
      write: false,
      run: (args) => read("list_sessions", args),
    },
    {
      name: "get_decision",
      title: "Get a decision",
      description:
        "One decision in detail: verdict, whether it can be approved and why, proposals with scores, open objections, the human decision and a link. " +
        "`decided` is the chosen proposal in full (approved by the human, else the recommendation, else the leading one) with architecture, components, risks, " +
        "assumptions and next steps, the hard requirements with their check status and the open objections; `implementationBrief` is the same as Markdown. " +
        "Before implementing, respect `decided.basis`: only `approved_by_human` is a human-approved decision – otherwise tell the user first.",
      inputSchema: { type: "object", properties: { sessionId: str("Session id (ses_…)") }, required: ["sessionId"], additionalProperties: false },
      write: false,
      run: async (args) => {
        const data = (await read("get_session", args)) as { href?: string };
        // The full decision (owner request 07.11.26): an editor agent has to know what was decided to act on it.
        const brief = decisionBrief(await getSessionView(db, actor, String(args.sessionId)));
        return {
          ...data,
          url: data.href ? abs(data.href) : null,
          decided: brief.chosen ? { ...brief.chosen, requirements: brief.requirements, openObjections: brief.objections } : null,
          implementationBrief: brief.implementationBrief,
        };
      },
    },
    {
      name: "list_open_steps",
      title: "List open steps",
      description: "What is waiting: decisions awaiting the human approval, failed or running councils, builds that failed or are running.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      write: false,
      run: () => read("list_open_steps", {}),
    },
    {
      name: "list_models",
      title: "List models",
      description: "Models of the workspace's own API keys (asked live from each provider), for choosing council participants.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      write: false,
      run: async () => {
        rateLimit(`mcp-models:${actor.userId}`, 10, 60_000);
        const credentials = await listCredentials(db, actor);
        const keys = await Promise.all(
          credentials.map(async (c) => {
            try {
              const { secret } = await decryptCredentialForUse(db, actor, getKeyring(), c.id);
              const models = await createAdapter(c.provider, secret).listModels(timeoutSignal(15_000));
              rememberModels(
                c.id,
                models.map((m) => m.modelId),
              );
              return { credentialId: c.id, provider: c.provider, label: c.label, models: models.slice(0, 60).map((m) => m.modelId), error: null };
            } catch (error) {
              return {
                credentialId: c.id,
                provider: c.provider,
                label: c.label,
                models: [],
                error: error instanceof ProviderError ? error.kind : "unavailable",
              };
            }
          }),
        );
        return { keys };
      },
    },
    {
      name: "get_requirements",
      title: "Get the requirement list",
      description:
        "The confirmed requirement list of a project and whether it is current. A council starts only on a current confirmed list – confirming is done by the user in the app (link included).",
      inputSchema: { type: "object", properties: { projectId: str("Project id (prj_…)") }, required: ["projectId"], additionalProperties: false },
      write: false,
      run: async (args) => {
        const projectId = String(args.projectId ?? "");
        const list = await latestRequirementList(db, actor, projectId);
        return {
          confirmed: list ? { version: list.version, items: list.items.map((i) => i.text), noHardRequirements: list.noHardRequirements } : null,
          confirmUrl: abs(`/projects/${projectId}`),
        };
      },
    },
    {
      name: "preview_council",
      title: "Preview a council",
      description: "Cost and step estimate for a council before it starts (no tokens are used). Show the upper bound to the user.",
      inputSchema: councilInput(false),
      write: false,
      run: (args) => previewSession(db, actor, String(args.projectId ?? ""), sessionInput(args)),
    },
  ];

  tools.push({
    name: "list_skills",
    title: "List decision skills",
    description: "Skills (decision templates) this workspace can use: official ones and the team's or your own. Pass an id as `skill` to ask_consyrion.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    write: false,
    run: async () => ({
      skills: (await listSkills(db, actor)).map((s) => ({ id: s.id, name: s.name, summary: s.summary, category: s.category, version: s.version, visibility: s.visibility })),
    }),
  });
  if (scope === "read") return tools;

  const action = (type: string) => async (args: Record<string, unknown>) => {
    const result = await runActionForClient(db, actor, type, args, "mcp");
    return { done: true, ...(result ? { label: result.label, url: abs(result.href) } : {}) };
  };
  tools.push(
    {
      name: "ask_consyrion",
      title: "Ask CONSYRION for a decision (costs tokens)",
      description:
        "One call for a decision while working: several models think independently, challenge each other and reach a documented verdict. " +
        "Give the question, the context (what you are building, constraints), optional options to compare and the hard requirements. " +
        "ASK THE USER FIRST: show them the requirements and the token budget – their approval of this call confirms the requirement list. " +
        `Costs tokens on the user's own keys; tokenBudget is required (max ${MCP_MAX_TOKEN_BUDGET.toLocaleString("en-US")}). ` +
        "Without participants the models of the last council are used. Returns at once; the council takes a few minutes – then call get_decision with the sessionId.",
      inputSchema: {
        type: "object",
        properties: {
          question: str("The decision to make, e.g. 'PostgreSQL or SQLite for the sync service?'"),
          context: str("What is being built, current state, constraints – the more concrete, the better the verdict"),
          options: { type: "array", maxItems: 6, items: { type: "string", maxLength: 300 }, description: "Optional options to compare" },
          requirements: {
            type: "array",
            maxItems: 20,
            items: { type: "string", maxLength: 500 },
            description: "Hard requirements the decision must meet (confirmed by the user)",
          },
          mode: { type: "string", enum: [...DECISION_MODES], description: "Default independent_expert" },
          participants: { ...participants, description: "Optional: 2–6 models from list_models; default = the models of the last council" },
          tokenBudget: {
            type: "integer",
            minimum: 10_000,
            maximum: MCP_MAX_TOKEN_BUDGET,
            description: `Upper token limit of the whole council (max ${MCP_MAX_TOKEN_BUDGET.toLocaleString("en-US")})`,
          },
          confirmBudget: { type: "boolean", description: "Set true only after the user accepted that phases may be shortened to stay within the budget" },
          files: {
            type: "array",
            maxItems: 20,
            description:
              "Optional small file excerpts the decision is about (e.g. the code to change, its tests, package.json) – only what is needed, at most 200 kB together. " +
              "The models read them as untrusted document data; they never become requirements. Without them requirements like 'existing tests stay green' cannot be verified. " +
              "Tell the user which files you send. Never send secrets (.env, keys, credentials).",
            items: {
              type: "object",
              properties: { path: str("Repository-relative path, e.g. src/lib/date.ts"), content: str("File content or the relevant excerpt (text)") },
              required: ["path", "content"],
              additionalProperties: false,
            },
          },
          skill: str(
            "Optional skill id from list_skills (or official:<slug>): pre-fills mode, perspectives, weights and session rules and is pinned in the verdict. Its requirement blocks are only suggestions – put the ones the user confirms into requirements",
          ),
        },
        required: ["question", "context", "tokenBudget"],
        additionalProperties: false,
      },
      write: true,
      run: async (args) => {
        rateLimit(`mcp-council:${actor.userId}`, 5, 60_000);
        if (typeof args.tokenBudget !== "number" || args.tokenBudget > MCP_MAX_TOKEN_BUDGET)
          throw new DomainError("VALIDATION", `tokenBudget is required over MCP and may be at most ${MCP_MAX_TOKEN_BUDGET.toLocaleString("en-US")}`);
        await assertClientDailyTokenBudget(db, actor, args.tokenBudget, mcpDailyTokenBudget());
        const list = (value: unknown) => (Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : []);
        let chosen = Array.isArray(args.participants) ? (args.participants as Array<{ credentialId: string; modelId: string }>) : [];
        if (!chosen.length) chosen = (await lastCouncilParticipants(db, actor)).map((p) => ({ credentialId: p.credentialId, modelId: p.modelId }));
        if (chosen.length < 2) throw new DomainError("VALIDATION", "No earlier council to copy the models from – pass 2–6 participants from list_models");
        // #363 part 3: a skill pre-fills the setup; its requirement blocks never become requirements by themselves.
        const skill = typeof args.skill === "string" && args.skill ? await getSkillForUse(db, actor, args.skill) : null;
        const fromSkill: Partial<SessionInput> = skill
          ? {
              ...(skill.content.roles?.length ? { roles: skill.content.roles } : {}),
              ...(skill.content.weights ? { weights: skill.content.weights } : {}),
              ...(skill.content.sessionRules ? { customRules: skill.content.sessionRules } : {}),
              skill: { id: skill.ref.skillId, version: skill.ref.version },
            }
          : {};
        const mode = typeof args.mode === "string" ? args.mode : (skill?.content.council?.mode ?? "independent_expert");
        const files = Array.isArray(args.files)
          ? args.files
              .filter((f): f is { path: unknown; content: unknown } => typeof f === "object" && f !== null)
              .map((f) => ({ path: typeof f.path === "string" ? f.path : "", content: typeof f.content === "string" ? f.content : "" }))
          : [];
        const {
          project,
          requirements,
          files: attached,
        } = await createProjectForDecisionRequest(
          db,
          actor,
          {
            question: String(args.question ?? ""),
            context: String(args.context ?? ""),
            options: list(args.options),
            requirements: list(args.requirements),
            files,
          },
          "mcp",
        );
        // A refused start (budget not confirmed, unknown model, plan limit) must not leave a project behind that the
        // next attempt duplicates (QA 07.11.26): it is archived and the error goes back to the client.
        const session = await createSession(
          db,
          actor,
          project.id,
          sessionInput({ ...args, mode, participants: chosen }, fromSkill),
          modelCatalog(db, actor),
        ).catch(async (error: unknown) => {
          await archiveProject(db, actor, project.id).catch(() => {});
          throw error;
        });
        // #429: counts against the daily client budget (the web app never does).
        await recordClientCouncilStart(db, actor, session.id, "mcp");
        return {
          sessionId: session.id,
          status: "queued",
          url: abs(`/sessions/${session.id}`),
          projectUrl: abs(`/projects/${project.id}`),
          requirementsConfirmed: requirements,
          ...(attached.length ? { filesAttached: attached } : {}),
          participants: chosen.map((p) => p.modelId),
          tokenBudget: args.tokenBudget,
          ...(skill
            ? {
                skill: { id: skill.ref.skillId, name: skill.ref.name, version: skill.ref.version },
                skillRequirementBlocks: skill.content.requirementBlocks ?? [],
              }
            : {}),
          next: "The council runs for a few minutes. Call get_decision with this sessionId to see the phase and, at the end, the verdict.",
        };
      },
    },
    {
      name: "create_project_draft",
      title: "Create a project draft",
      description: "Creates a new project as a DRAFT (not ready for a council until the user marks it ready in the app).",
      inputSchema: {
        type: "object",
        properties: {
          name: str("2–120 characters"),
          type: { type: "string", enum: PROJECT_TYPES },
          idea: str("The idea, at least 20 characters"),
          goal: str("Desired outcome"),
          requirements: str("Requirements, one per line"),
        },
        required: ["name", "idea"],
        additionalProperties: false,
      },
      write: true,
      run: action("create_project_draft"),
    },
    {
      name: "update_brief",
      title: "New brief version",
      description:
        "Saves a new brief version of a project (earlier versions stay; the repository link is kept). The requirement list must be confirmed again in the app.",
      inputSchema: {
        type: "object",
        properties: {
          projectId: str("Project id (prj_…)"),
          idea: str("Full idea text, at least 20 characters"),
          goal: str("Desired outcome"),
          requirements: str("Requirements, one per line"),
        },
        required: ["projectId", "idea"],
        additionalProperties: false,
      },
      write: true,
      run: action("draft_brief"),
    },
    {
      name: "propose_requirements",
      title: "Propose requirements",
      description: "Adds requirements to the project brief. They stay UNCONFIRMED until the user confirms the requirement list in the app.",
      inputSchema: {
        type: "object",
        properties: {
          projectId: str("Project id (prj_…)"),
          requirements: { type: "array", minItems: 1, maxItems: 20, items: { type: "string", maxLength: 500 } },
        },
        required: ["projectId", "requirements"],
        additionalProperties: false,
      },
      write: true,
      run: action("propose_requirements"),
    },
    {
      name: "start_council",
      title: "Start a council (costs tokens)",
      description:
        `Starts a council on the user's own API keys – this COSTS TOKENS. Call preview_council first and tell the user the estimate; tokenBudget is required (max ${MCP_MAX_TOKEN_BUDGET.toLocaleString("en-US")}). ` +
        "Needs a current confirmed requirement list. Returns the session id and link; the run takes minutes – check it with get_decision.",
      inputSchema: councilInput(true),
      write: true,
      run: async (args) => {
        rateLimit(`mcp-council:${actor.userId}`, 5, 60_000);
        if (typeof args.tokenBudget !== "number" || args.tokenBudget > MCP_MAX_TOKEN_BUDGET)
          throw new DomainError("VALIDATION", `tokenBudget is required over MCP and may be at most ${MCP_MAX_TOKEN_BUDGET.toLocaleString("en-US")}`);
        await assertClientDailyTokenBudget(db, actor, args.tokenBudget, mcpDailyTokenBudget());
        const session = await createSession(db, actor, String(args.projectId ?? ""), sessionInput(args), modelCatalog(db, actor));
        await recordClientCouncilStart(db, actor, session.id, "mcp");
        return { sessionId: session.id, status: "queued", tokenBudget: args.tokenBudget, url: abs(`/sessions/${session.id}`) };
      },
    },
  );
  return tools;
}
