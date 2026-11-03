import { DomainError } from "./errors";

export const SESSION_STATUSES = [
  "queued",
  "running",
  "cancel_requested",
  "cancelled",
  "failed",
  "awaiting_approval",
  "approved",
  "rejected",
  "changes_requested",
] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];

const TRANSITIONS: Record<SessionStatus, readonly SessionStatus[]> = {
  queued: ["running", "cancelled", "failed"],
  running: ["awaiting_approval", "cancel_requested", "failed", "cancelled"],
  cancel_requested: ["cancelled", "failed"],
  cancelled: [],
  failed: ["queued"],
  awaiting_approval: ["approved", "rejected", "changes_requested", "queued"],
  approved: [],
  rejected: [],
  changes_requested: [],
};

export function canTransition(from: SessionStatus, to: SessionStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: SessionStatus, to: SessionStatus): void {
  if (!canTransition(from, to)) throw new DomainError("CONFLICT", `Session cannot move from ${from} to ${to}`);
}

export const TERMINAL_STATUSES: ReadonlySet<SessionStatus> = new Set(["cancelled", "approved", "rejected", "changes_requested"]);
