import {
  addAssistantMessage,
  createAssistantChat,
  createDatabase,
  ensurePersonalOrganization,
  resolveActor,
  schema,
  type ActorContext,
  type DatabaseHandle,
} from "@consyrium/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
let handle: DatabaseHandle;
let actor: ActorContext;
vi.mock("@/lib/server/db", () => ({ getDb: async () => handle.db }));
vi.mock("@/lib/server/actor", () => ({ requireActor: async () => actor }));
vi.mock("@/lib/server/feedback", () => ({ notifyAdminsAboutFeedback: async () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }), headers: async () => new Headers() }));
vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string, values?: { title?: string }) => (values?.title ? `${key}: ${values.title}` : key),
}));
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), after: () => {} }));

const { POST } = await import("./route");

let owner: ActorContext;
let other: ActorContext;
let chatId: string;
const call = (body: unknown) =>
  POST(new Request("http://localhost/x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), {
    params: Promise.resolve({ id: chatId }),
  });

beforeAll(async () => {
  handle = createDatabase("memory://");
  await handle.migrate();
  for (const id of ["u_rep", "u_other"]) await handle.db.insert(schema.user).values({ id, name: id, email: `${id}@example.test` });
  owner = await resolveActor(handle.db, "u_rep", (await ensurePersonalOrganization(handle.db, "u_rep", "Rep")).id);
  other = await resolveActor(handle.db, "u_other", (await ensurePersonalOrganization(handle.db, "u_other", "Other")).id);
  const chat = await createAssistantChat(handle.db, owner, { title: "Falsche Antwort" });
  chatId = chat.id;
  await addAssistantMessage(handle.db, owner, chat.id, { role: "user", content: "Mein Key ist sk-ant-abcdefghijklmnopqrstuvwx – welche Schritte sind offen?" });
  await addAssistantMessage(handle.db, owner, chat.id, {
    role: "assistant",
    content: "Zwei Schritte sind offen.",
    model: "anthropic/claude-haiku-5-5",
    tools: [{ name: "list_open_steps", args: { secretNote: "TOOLDATA" } }],
    links: [{ label: "Projekt", href: "/projects/prj_hidden" }],
  });
});

afterAll(async () => {
  await handle.close();
});

describe("report an assistant conversation (#486 part 3)", () => {
  it("previews exactly what would be sent – shortened, without keys, tool data or links – and stores nothing", async () => {
    actor = owner;
    const response = await call({ preview: true });
    const { excerpt } = (await response.json()) as { excerpt: string };
    expect(excerpt).toContain("you: Mein Key ist [redacted]");
    expect(excerpt).toContain("assistant (anthropic/claude-haiku-5-5): Zwei Schritte sind offen.");
    expect(excerpt).not.toMatch(/sk-ant|TOOLDATA|prj_hidden|list_open_steps/);
    expect(await handle.db.select().from(schema.feedback)).toHaveLength(0);
  });

  it("sends only with consent and an explanation, and stores the explanation plus that excerpt", async () => {
    actor = owner;
    expect((await call({ explanation: "Falsche Zahl", consent: false })).status).toBe(422);
    expect((await call({ explanation: "", consent: true })).status).toBe(422);
    const response = await call({ explanation: "Es sind drei Schritte offen, nicht zwei.", consent: true });
    expect(response.status).toBe(201);
    const [row] = await handle.db.select().from(schema.feedback);
    expect(row).toMatchObject({ kind: "bug", userId: "u_rep", page: "/assistant", subject: "subject: Falsche Antwort" });
    expect(row!.text).toMatch(/^Es sind drei Schritte offen, nicht zwei\.\n\n---\nyou: /);
    expect(row!.text).not.toMatch(/sk-ant|TOOLDATA|prj_hidden/);
  });

  it("another user cannot preview or report someone else's chat", async () => {
    actor = other;
    expect((await call({ preview: true })).status).toBe(404);
    expect((await call({ explanation: "x y z", consent: true })).status).toBe(404);
  });
});
