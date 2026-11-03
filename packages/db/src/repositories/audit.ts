import type { Database } from "../client";
import { newId } from "../ids";
import { auditEvent } from "../schema";

export interface AuditInput {
  organizationId: string | null;
  actorUserId: string | null;
  action: string;
  targetType: string;
  targetId?: string | null;
  metadata?: Record<string, unknown>;
}

const SECRET_KEY_PATTERN = /(secret|password|token|api[_-]?key|authorization)/i;

/** Drops keys that look like secrets so a careless caller cannot leak them into the audit log. */
export function sanitizeAuditMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(metadata).filter(([key]) => !SECRET_KEY_PATTERN.test(key)));
}

export async function recordAudit(db: Pick<Database, "insert">, input: AuditInput): Promise<void> {
  await db.insert(auditEvent).values({
    id: newId("aud"),
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId ?? null,
    metadata: sanitizeAuditMetadata(input.metadata ?? {}),
  });
}
