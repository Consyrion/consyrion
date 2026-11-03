/**
 * Local development only: fills the PGlite dev database with one council session produced by the
 * SCRIPTED TEST MODELS, so every screen can be inspected without provider keys. The project and the
 * model names are labelled as demo data. Never run against a production database.
 *
 *   pnpm --filter @consyrion/council seed:demo -- tester@example.test
 */
import { createDatabase, createProject, newId, resolveActor, schema } from "@consyrion/db";
import { and, eq } from "drizzle-orm";
import path from "node:path";
import { createSession, runSession } from "../src";
import { confirmProposedRequirements } from "./confirm-requirements";
import { ScriptedAdapter } from "./scripted-adapter";

if (process.env.DATABASE_URL) throw new Error("Refusing to seed demo data into DATABASE_URL; this script is for the local PGlite database only.");
const email = process.argv[2] ?? "tester@example.test";
const handle = createDatabase(path.resolve(import.meta.dirname, "../../../.data/pglite"));
await handle.migrate();
const db = handle.db;
const [user] = await db.select().from(schema.user).where(eq(schema.user.email, email));
if (!user) throw new Error(`No user ${email}; sign up in the app first.`);
const [membership] = await db.select().from(schema.membership).where(eq(schema.membership.userId, user.id));
const actor = await resolveActor(db, user.id, membership!.organizationId);

const project = await createProject(db, actor, {
  name: "DEMO – scripted test models (not real AI output)",
  type: "architecture",
  brief: {
    idea: "Design an architecture for a SaaS that analyzes GitHub repositories and proposes code improvements. (Demo data produced by scripted test models.)",
    goal: "Show every council screen with stored data.",
  },
});
const DEMO_LABEL = "DEMO scripted (not a real key)";
const [existingCredential] = await db
  .select()
  .from(schema.aiProviderCredential)
  .where(and(eq(schema.aiProviderCredential.label, DEMO_LABEL), eq(schema.aiProviderCredential.organizationId, actor.organizationId)));
const credentialId = existingCredential?.id ?? newId("cred");
if (!existingCredential)
  await db.insert(schema.aiProviderCredential).values({
    id: credentialId,
    organizationId: actor.organizationId,
    provider: "anthropic",
    label: DEMO_LABEL,
    encryptedSecret: "v1.demo.demo.demo",
    keyVersion: 1,
    secretHint: "demo",
    createdById: user.id,
  });
const preferFirst = (labels: string[], _own: string, prompt: string) =>
  labels.find((l) => prompt.split(`<proposal label="${l}">`)[1]?.includes('"title": "Modular monolith"')) ?? labels[0]!;
const scripts = {
  "scripted-test-model-1": new ScriptedAdapter({
    title: "Modular monolith",
    prefer: preferFirst,
    adjudicate: () => "accepted",
    score: (t) => (t === "Modular monolith" ? 8 : t === "Serverless pipeline" ? 7 : 6),
  }),
  "scripted-test-model-2": new ScriptedAdapter({
    title: "Agent microservices",
    prefer: preferFirst,
    critiques: [{ againstTitle: "Serverless pipeline", claim: "Cold starts make interactive analysis slow", category: "performance", severity: "high" }],
    adjudicate: () => "refuted",
    score: (t) => (t === "Modular monolith" ? 8 : 6),
  }),
  "scripted-test-model-3": new ScriptedAdapter({
    title: "Serverless pipeline",
    critiques: [
      { againstTitle: "Modular monolith", claim: "Repository tokens are stored without per-tenant encryption", category: "security", severity: "critical" },
    ],
    score: (t) => (t === "Serverless pipeline" ? 8 : 7),
  }),
};
await confirmProposedRequirements(db, actor, project.id);
const { id } = await createSession(db, actor, project.id, {
  mode: "adversarial_review",
  participants: Object.keys(scripts).map((modelId) => ({ credentialId, modelId })),
  customRules: "Demo session.",
  confirmBudget: true,
});
await db
  .update(schema.job)
  .set({ status: "done" })
  .where(eq(schema.job.dedupeKey, `council.run:${id}:0`));
await runSession({ db, resolveAdapter: async (p) => scripts[p.modelId as keyof typeof scripts], random: Math.random }, id);
console.log(`Demo session ${id} for project ${project.id}`);
await handle.close();
