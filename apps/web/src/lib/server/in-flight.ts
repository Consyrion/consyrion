import "server-only";
import { DomainError } from "@consyrium/core";

/**
 * Refuses a second identical paid request while the first one still runs (#510 load test: a double click on "second
 * opinion" or "cross-check" called the model twice and paid twice, although only one record was stored). Per server
 * process – the unique indexes in the database stay the guarantee across processes.
 */
const running = new Set<string>();

export async function onceAtATime<T>(key: string, run: () => Promise<T>): Promise<T> {
  if (running.has(key)) throw new DomainError("CONFLICT", "This request is already running – please wait for the result");
  running.add(key);
  try {
    return await run();
  } finally {
    running.delete(key);
  }
}
