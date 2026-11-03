import { createDatabase } from "./client";

const url = process.env.DATABASE_URL || process.env.PGLITE_DIR || "../../.data/pglite";
const handle = createDatabase(url);
await handle.migrate();
await handle.close();
console.log(`Migrations applied (${handle.kind}).`);
