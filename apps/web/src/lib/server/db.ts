import "server-only";
import { createDatabase, type Database, type DatabaseHandle } from "@consyrium/db";
import path from "node:path";

type State = { handle: DatabaseHandle; ready: Promise<void> | null };
const globalForDb = globalThis as unknown as { consyriumDb?: State };

/** Opened on first use, never at import, so builds and route analysis do not start a database. */
function state(): State {
  if (!globalForDb.consyriumDb) {
    const url = process.env.DATABASE_URL || path.resolve(process.cwd(), "../../.data/pglite");
    const handle = createDatabase(url, { migrationsFolder: path.resolve(process.cwd(), "../../packages/db/drizzle") });
    globalForDb.consyriumDb = { handle, ready: null };
  }
  return globalForDb.consyriumDb;
}

/**
 * Embedded PGlite migrates itself on first use; PostgreSQL is migrated explicitly (`pnpm db:migrate`).
 * PGlite is refused at runtime in production so a missing DATABASE_URL can never silently create
 * an ephemeral database on a server.
 */
export function dbReady(): Promise<void> {
  const current = state();
  if (!current.ready) {
    if (current.handle.kind === "pglite" && process.env.NODE_ENV === "production") {
      current.ready = Promise.reject(new Error("DATABASE_URL must point to PostgreSQL in production; PGlite is for local development only."));
    } else {
      current.ready = current.handle.kind === "pglite" ? current.handle.migrate() : Promise.resolve();
    }
  }
  return current.ready;
}

export async function getDb(): Promise<Database> {
  await dbReady();
  return state().handle.db;
}
