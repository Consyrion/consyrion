import { ARTIFICIAL_ANALYSIS, fetchArtificialAnalysis } from "@consyrium/ai";
import type { StrengthCatalog, StrengthEntry } from "@consyrium/core";
import { newId, schema, type Database } from "@consyrium/db";
import { and, desc, eq } from "drizzle-orm";
import { enqueue } from "./queue";

export const MODEL_STRENGTH_JOB = "model_strength.sync";

/** A ranking source: its name for attribution and how to load its entries. */
export interface StrengthSource {
  source: string;
  sourceUrl: string;
  load: () => Promise<StrengthEntry[]>;
}

/** The configured source, or null without a key (then every model is "unknown", tier 5). */
export function strengthSourceFromEnv(env: Record<string, string | undefined>): StrengthSource | null {
  const key = env.ARTIFICIAL_ANALYSIS_API_KEY?.trim();
  return key ? { ...ARTIFICIAL_ANALYSIS, load: () => fetchArtificialAnalysis(key) } : null;
}

/**
 * Fetches the ranking and stores it (#139). A failure is stored as a failed attempt and never touches the last good
 * catalog, so councils keep the previous suggestions (marked stale after seven days).
 */
export async function syncModelStrength(db: Database, source: StrengthSource) {
  try {
    const entries = await source.load();
    if (entries.length === 0) throw new Error("The ranking returned no models with a score");
    await db.insert(schema.modelStrengthSync).values({ id: newId("mss"), source: source.source, sourceUrl: source.sourceUrl, ok: true, entries });
    return { ok: true as const, entries: entries.length };
  } catch (error) {
    // Content-free: the message never contains the key.
    const message = (error instanceof Error ? error.message : "Ranking fetch failed").slice(0, 300);
    await db.insert(schema.modelStrengthSync).values({ id: newId("mss"), source: source.source, sourceUrl: source.sourceUrl, ok: false, error: message });
    return { ok: false as const, error: message };
  }
}

/** The newest successful catalog, or null if none was ever fetched. */
export async function latestStrengthCatalog(db: Database): Promise<StrengthCatalog | null> {
  const [row] = await db
    .select()
    .from(schema.modelStrengthSync)
    .where(eq(schema.modelStrengthSync.ok, true))
    .orderBy(desc(schema.modelStrengthSync.fetchedAt))
    .limit(1);
  return row ? { source: row.source, sourceUrl: row.sourceUrl, fetchedAt: row.fetchedAt, entries: row.entries } : null;
}

/** Last attempt and last success, for the platform admin. */
export async function modelStrengthStatus(db: Database) {
  const [last] = await db.select().from(schema.modelStrengthSync).orderBy(desc(schema.modelStrengthSync.fetchedAt)).limit(1);
  const [lastOk] = await db
    .select({ fetchedAt: schema.modelStrengthSync.fetchedAt, source: schema.modelStrengthSync.source })
    .from(schema.modelStrengthSync)
    .where(and(eq(schema.modelStrengthSync.ok, true)))
    .orderBy(desc(schema.modelStrengthSync.fetchedAt))
    .limit(1);
  return {
    lastAttempt: last ? { at: last.fetchedAt, ok: last.ok, error: last.error, entries: last.entries.length } : null,
    lastSuccess: lastOk ?? null,
  };
}

/** One sync per day: the dedupe key makes repeated scheduling (every worker start, every hour) harmless. */
export async function scheduleModelStrengthSync(db: Database, now: Date = new Date()) {
  await enqueue(db, MODEL_STRENGTH_JOB, {}, `${MODEL_STRENGTH_JOB}:${now.toISOString().slice(0, 10)}`);
}
