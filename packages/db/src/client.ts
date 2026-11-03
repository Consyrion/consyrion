import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { migrate as migratePg } from "drizzle-orm/node-postgres/migrator";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import pg from "pg";
import * as schema from "./schema";

/** Common base of the PostgreSQL and PGlite drivers; repositories only depend on this. */
export type Database = PgDatabase<PgQueryResultHKT, typeof schema>;

export interface DatabaseHandle {
  db: Database;
  kind: "postgres" | "pglite";
  migrate(): Promise<void>;
  close(): Promise<void>;
}

export interface DatabaseOptions {
  /** Absolute path to the drizzle migrations. Bundlers (Next.js) must pass it explicitly. */
  migrationsFolder?: string;
}

function defaultMigrationsFolder(): string {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "drizzle");
}

/**
 * `postgres://…` connects to PostgreSQL. Anything else is treated as a PGlite data directory
 * (`memory://` for tests). PGlite is for local development and tests only.
 */
export function createDatabase(url: string | undefined, options: DatabaseOptions = {}): DatabaseHandle {
  const migrationsFolder = () => options.migrationsFolder ?? defaultMigrationsFolder();
  if (url && /^postgres(ql)?:\/\//.test(url)) {
    const pool = new pg.Pool({ connectionString: url });
    const db = drizzlePg(pool, { schema });
    return {
      db: db as unknown as Database,
      kind: "postgres",
      migrate: () => migratePg(db, { migrationsFolder: migrationsFolder() }),
      close: () => pool.end(),
    };
  }
  const dataDir = url && url !== "memory://" ? url : undefined;
  if (dataDir) mkdirSync(path.dirname(path.resolve(dataDir)), { recursive: true });
  const client = new PGlite(dataDir);
  const db = drizzlePglite(client, { schema });
  return {
    db: db as unknown as Database,
    kind: "pglite",
    migrate: () => migratePglite(db, { migrationsFolder: migrationsFolder() }),
    close: () => client.close(),
  };
}
