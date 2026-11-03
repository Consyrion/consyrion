/**
 * Local development only: approves the newest DEMO session and runs the Execution Council with
 * scripted test models. Without a container runtime the tests are reported as "not run".
 *
 *   pnpm --filter @consyrion/build seed:demo-execution -- tester@example.test
 */
import { submitApproval } from "@consyrion/council";
import { createDatabase, resolveActor, schema } from "@consyrion/db";
import { desc, eq, like } from "drizzle-orm";
import path from "node:path";
import { detectSandbox, runExecution, startExecution } from "../src";
import { ScriptedAdapter } from "../../council/test/scripted-adapter";
import { ScriptedEngineer } from "./scripted-engineer";

if (process.env.DATABASE_URL) throw new Error("Refusing to seed demo data into DATABASE_URL.");
const email = process.argv[2] ?? "tester@example.test";
const handle = createDatabase(path.resolve(import.meta.dirname, "../../../.data/pglite"));
await handle.migrate();
const db = handle.db;
const [user] = await db.select().from(schema.user).where(eq(schema.user.email, email));
const [membership] = await db.select().from(schema.membership).where(eq(schema.membership.userId, user!.id));
const actor = await resolveActor(db, user!.id, membership!.organizationId);
const [project] = await db.select().from(schema.project).where(like(schema.project.name, "DEMO%")).orderBy(desc(schema.project.createdAt)).limit(1);
const [session] = await db.select().from(schema.councilSession).where(eq(schema.councilSession.projectId, project!.id)).orderBy(desc(schema.councilSession.createdAt)).limit(1);
if (session!.status === "awaiting_approval") await submitApproval(db, actor, session!.id, { action: "approve", comment: "Demo approval" });
const { id } = await startExecution(db, actor, session!.id, { requirePlanApproval: false });
await db.update(schema.job).set({ status: "done" }).where(eq(schema.job.dedupeKey, `execution.run:${id}`));
const engineer = new ScriptedEngineer(new ScriptedAdapter({ title: "unused" }));
await runExecution({ db, resolveAdapter: async () => engineer, sandbox: await detectSandbox() }, id);
console.log(`Demo execution ${id} for session ${session!.id}`);
await handle.close();
