/**
 * OpenAPI 3.1 description of API v1 (#101): the endpoints an integration token may use. Served at
 * /api/v1/openapi.json. The full endpoint list (web app, VS Code) is in docs/api.md.
 */

const json = (schema: object) => ({ "application/json": { schema } });
const error = { $ref: "#/components/responses/Error" };
const errors = { "401": error, "403": error, "404": error, "409": error, "422": error, "429": error };
const id = (name: string, description: string) => ({ name, in: "path", required: true, schema: { type: "string" }, description });
const projectId = id("projectId", "Project id (prj_…)");
const sessionId = id("sessionId", "Council session id (ses_…)");

export const openApiDocument = {
  openapi: "3.1.0",
  info: {
    title: "CONSYRION AI API",
    version: "1.0.0",
    description: [
      "Run CONSYRION AI councils from other tools. Authenticate with `Authorization: Bearer cni_…` (integration token,",
      "created under Settings → API tokens). An integration token acts as you in one workspace and may create projects,",
      "attach documents, confirm requirements, start, read and cancel councils. It can never approve a verdict, start a",
      "build, open a pull request, manage keys, members or tokens, or delete a project – those stay with a human in the",
      "web app. Model calls are billed to your own provider keys (BYOK).",
      "",
      "Typical flow: create project → (attach documents) → GET requirements → POST requirements (confirm) → GET models",
      "and credentials → POST preview → POST sessions with an Idempotency-Key → poll GET session (or the events stream)",
      "until `awaiting_approval`, `failed` or `cancelled` → GET report.",
    ].join("\n"),
  },
  servers: [{ url: "/api/v1" }],
  security: [{ bearer: [] }],
  paths: {
    "/projects": {
      get: { summary: "List projects", responses: { "200": { description: "Projects", content: json({ type: "object" }) }, ...errors } },
      post: {
        summary: "Create a project",
        requestBody: { required: true, content: json({ $ref: "#/components/schemas/ProjectInput" }) },
        responses: { "201": { description: "Created project", content: json({ type: "object" }) }, ...errors },
      },
    },
    "/projects/{projectId}": {
      parameters: [projectId],
      get: { summary: "Project with its current brief", responses: { "200": { description: "Project", content: json({ type: "object" }) }, ...errors } },
      patch: {
        summary: "Save a new brief version",
        requestBody: { required: true, content: json({ $ref: "#/components/schemas/BriefInput" }) },
        responses: { "200": { description: "Updated project", content: json({ type: "object" }) }, ...errors },
      },
    },
    "/projects/{projectId}/documents": {
      parameters: [projectId],
      get: { summary: "List documents", responses: { "200": { description: "Documents and limits", content: json({ type: "object" }) }, ...errors } },
      post: {
        summary: "Attach a document",
        description: "Text up to 200 kB; PDF, DOCX, PPTX up to 8 MB, stored as their extracted text (at most 200 kB); images (PNG, JPEG, WebP, GIF) up to 3.5 MB, described first. See docs/documents.md.",
        requestBody: {
          required: true,
          content: { "multipart/form-data": { schema: { type: "object", required: ["file"], properties: { file: { type: "string", format: "binary" } } } } },
        },
        responses: { "201": { description: "Stored document", content: json({ type: "object" }) }, ...errors },
      },
    },
    "/projects/{projectId}/documents/{documentId}": {
      parameters: [projectId, id("documentId", "Document id (doc_…)")],
      delete: { summary: "Remove a document", responses: { "204": { description: "Removed" }, ...errors } },
    },
    "/projects/{projectId}/documents/{documentId}/describe": {
      parameters: [projectId, id("documentId", "Document id (doc_…) of an image")],
      post: {
        summary: "Let one image-capable model describe an uploaded image (draft)",
        description:
          "One paid call on your own key. The description is stored as a draft; confirm it (PUT description) before requirements can be confirmed or a council can start. Councils only ever see the confirmed text.",
        requestBody: {
          required: true,
          content: json({ type: "object", required: ["credentialId", "modelId"], properties: { credentialId: { type: "string" }, modelId: { type: "string" } } }),
        },
        responses: { "200": { description: "Draft description and token usage", content: json({ type: "object" }) }, ...errors },
      },
    },
    "/projects/{projectId}/documents/{documentId}/description": {
      parameters: [projectId, id("documentId", "Document id (doc_…) of an image")],
      put: {
        summary: "Confirm the reviewed (or self-written) description of an image",
        requestBody: { required: true, content: json({ type: "object", required: ["text"], properties: { text: { type: "string", minLength: 20, maxLength: 20000 } } }) },
        responses: { "200": { description: "Confirmed", content: json({ type: "object" }) }, ...errors },
      },
    },
    "/projects/{projectId}/requirements": {
      parameters: [projectId],
      get: {
        summary: "Proposed hard requirements and confirmed versions",
        description: "A council can only start on a requirement list confirmed for the current brief and documents.",
        responses: { "200": { description: "proposal (source.hash, items to confirm, excluded) and history", content: json({ type: "object" }) }, ...errors },
      },
      post: {
        summary: "Confirm a requirement list version",
        requestBody: { required: true, content: json({ $ref: "#/components/schemas/RequirementConfirmation" }) },
        responses: { "201": { description: "Confirmed list", content: json({ type: "object" }) }, ...errors },
      },
    },
    "/credentials": {
      get: {
        summary: "Your provider keys (ids and labels, never the secret)",
        responses: { "200": { description: "Credentials", content: json({ type: "object" }) }, ...errors },
      },
    },
    "/models": {
      get: {
        summary: "Models available with your keys (live from the providers)",
        responses: { "200": { description: "Models per credential", content: json({ type: "object" }) }, ...errors },
      },
    },
    "/projects/{projectId}/sessions/preview": {
      parameters: [projectId],
      post: {
        summary: "Cost preview (number of calls, upper bound and typical tokens) – no model calls",
        requestBody: { required: true, content: json({ $ref: "#/components/schemas/SessionInput" }) },
        responses: { "200": { description: "Preview", content: json({ type: "object" }) }, ...errors },
      },
    },
    "/projects/{projectId}/sessions": {
      parameters: [projectId],
      get: { summary: "Councils of the project", responses: { "200": { description: "Sessions", content: json({ type: "object" }) }, ...errors } },
      post: {
        summary: "Start a council (asynchronous)",
        description:
          "Queues the council and returns its id at once; model calls run in the background. Send an Idempotency-Key: the same key with the same body within 24 hours returns the first session (200, replayed: true) instead of starting – and paying for – a second one; the same key with another body is 409. At most 10 starts per minute.",
        parameters: [{ name: "Idempotency-Key", in: "header", required: false, schema: { type: "string", maxLength: 200 } }],
        requestBody: { required: true, content: json({ $ref: "#/components/schemas/SessionInput" }) },
        responses: {
          "201": {
            description: "Queued",
            content: json({ type: "object", properties: { session: { type: "object", properties: { id: { type: "string" } } } } }),
          },
          "200": {
            description: "Replayed (same Idempotency-Key and body)",
            content: json({ type: "object", properties: { session: { type: "object", properties: { id: { type: "string" } } }, replayed: { const: true } } }),
          },
          ...errors,
        },
      },
    },
    "/sessions": { get: { summary: "Your recent councils", responses: { "200": { description: "Sessions", content: json({ type: "object" }) }, ...errors } } },
    "/sessions/{sessionId}": {
      parameters: [sessionId],
      get: {
        summary: "Council state: status, phases, participants, proposals, decision",
        description:
          "status: queued, running, cancel_requested, awaiting_approval (finished – a human decides in the web app), failed, cancelled. decisionStatus says whether the verdict can be approved at all.",
        responses: { "200": { description: "Session view", content: json({ type: "object" }) }, ...errors },
      },
    },
    "/sessions/{sessionId}/events": {
      parameters: [sessionId],
      get: { summary: "Progress as Server-Sent Events", responses: { "200": { description: "text/event-stream" }, ...errors } },
    },
    "/sessions/{sessionId}/cancel": {
      parameters: [sessionId],
      post: {
        summary: "Stop a council",
        description: "No new model calls start; calls already running finish and are billed by the provider.",
        responses: { "200": { description: "Status", content: json({ type: "object" }) }, ...errors },
      },
    },
    "/sessions/{sessionId}/report": {
      parameters: [sessionId, { name: "format", in: "query", schema: { enum: ["md", "json", "pdf", "docx"] }, description: "Default Markdown" }],
      get: {
        summary: "Final Decision Report",
        description: "The same content in every format; a verdict that is not approvable says so (decisionFormat.approvable in JSON).",
        responses: { "200": { description: "Report" }, ...errors },
      },
    },
  },
  components: {
    securitySchemes: { bearer: { type: "http", scheme: "bearer", description: "Integration token cni_… (or a full-access token cns_…)" } },
    responses: {
      Error: {
        description: "Error",
        content: json({
          type: "object",
          properties: {
            error: { type: "object", required: ["code", "message"], properties: { code: { type: "string" }, message: { type: "string" }, details: {} } },
          },
        }),
      },
    },
    schemas: {
      BriefInput: {
        type: "object",
        required: ["idea"],
        properties: {
          idea: { type: "string", minLength: 20, maxLength: 20000 },
          goal: { type: "string", maxLength: 5000 },
          requirements: { type: "string", maxLength: 20000, description: "Hard requirements in plain sentences" },
        },
      },
      ProjectInput: {
        type: "object",
        required: ["name", "type", "brief"],
        properties: {
          name: { type: "string", minLength: 2, maxLength: 120 },
          type: { enum: ["idea", "architecture", "repository", "business", "technology_choice"] },
          intent: { enum: ["decision", "build", "both"], default: "decision" },
          brief: { $ref: "#/components/schemas/BriefInput" },
        },
      },
      RequirementConfirmation: {
        type: "object",
        required: ["sourceHash", "items"],
        properties: {
          sourceHash: {
            type: "string",
            description: "proposal.source.hash from GET requirements – proves the list was confirmed for the current brief and documents",
          },
          items: { type: "array", items: { type: "object", required: ["text"], properties: { text: { type: "string" }, candidateKey: { type: "string" } } } },
          excluded: { type: "array", items: { type: "object", properties: { candidateKey: { type: "string" }, reason: { type: "string" } } } },
          noHardRequirements: { type: "boolean" },
        },
      },
      SessionInput: {
        type: "object",
        required: ["mode", "participants"],
        properties: {
          mode: { enum: ["independent_expert", "adversarial_review", "consensus"] },
          participants: {
            type: "array",
            minItems: 2,
            maxItems: 6,
            items: {
              type: "object",
              required: ["credentialId", "modelId"],
              properties: { credentialId: { type: "string" }, modelId: { type: "string" }, voteWeight: { type: "integer", minimum: 1, maximum: 10 } },
            },
          },
          roles: { type: "array", items: { type: "string" } },
          debateRounds: { type: "integer" },
          consensusRounds: { type: "integer" },
          allowHybrid: { type: "boolean" },
          tokenBudget: { type: "integer", description: "Hard limit for the whole council" },
          customRules: { type: "string", maxLength: 2000 },
          confirmBudget: { type: "boolean", description: "Required when the preview's upper bound exceeds the budget" },
        },
      },
    },
  },
} as const;
