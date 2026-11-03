import { MAX_CALL_OUTPUT_TOKENS, outputTokensFor, type WorkflowPolicy } from "@consyrion/core";
import { schema, type Database } from "@consyrion/db";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { TRANSIENT_RETRY_DELAY_MS, type CallErrorKind } from "./call";

export type Participant = typeof schema.councilParticipant.$inferSelect;
export type Session = typeof schema.councilSession.$inferSelect;

export interface ProposalWithLatest {
  proposal: typeof schema.proposal.$inferSelect;
  latest: typeof schema.proposalRevision.$inferSelect;
}

/** Read-side helpers shared by the phases. All queries are scoped to one session. */
export class SessionContext {
  constructor(
    readonly db: Database,
    public session: Session,
    /** Wait before the late retry of an overloaded provider (#146); shortened in tests. */
    readonly transientRetryDelayMs = TRANSIENT_RETRY_DELAY_MS,
  ) {}

  /** Tokens kept free for the Final Verdict while earlier phases run (#148); 0 during the Final Verdict. */
  verdictReserve = 0;

  /**
   * Output limit per participant after one of its answers was cut off (#172): its later calls start here instead of
   * being cut off again. Rebuilt from the usage rows when a run resumes (`restoreOutputFloors`).
   */
  readonly outputFloors = new Map<string, number>();

  /** Provider-side failures per `${phase}:${participantId}` in this run, with the last error kind (#175). */
  readonly providerFailures = new Map<string, { count: number; last: CallErrorKind }>();

  raiseOutputFloor(participantId: string, tokens: number) {
    if (tokens > (this.outputFloors.get(participantId) ?? 0)) this.outputFloors.set(participantId, tokens);
  }

  /** After a resume: participants already cut off in this session start with a doubled limit again. */
  async restoreOutputFloors() {
    const rows = await this.db
      .selectDistinct({ participantId: schema.usageRecord.participantId })
      .from(schema.usageRecord)
      .where(
        and(eq(schema.usageRecord.sessionId, this.session.id), eq(schema.usageRecord.outcome, "max_tokens"), eq(schema.usageRecord.errorKind, "max_tokens")),
      );
    const participants = await this.participants(false);
    for (const { participantId } of rows) {
      const participant = participants.find((p) => p.id === participantId);
      if (participant)
        this.raiseOutputFloor(participant.id, Math.min(MAX_CALL_OUTPUT_TOKENS, 2 * outputTokensFor(participant.provider, this.policy.maxOutputTokens)));
    }
  }

  get policy(): WorkflowPolicy {
    return this.session.policy as unknown as WorkflowPolicy;
  }

  get orgId() {
    return this.session.organizationId;
  }

  async reload(): Promise<Session> {
    const [row] = await this.db.select().from(schema.councilSession).where(eq(schema.councilSession.id, this.session.id));
    this.session = row!;
    return this.session;
  }

  /**
   * The frozen brief plus the documents that were attached when the session started and the confirmed requirement
   * list the run is bound to (#190; null for runs before it).
   */
  async brief() {
    const [row] = await this.db.select().from(schema.projectBrief).where(eq(schema.projectBrief.id, this.session.briefId));
    const [requirementList] = this.session.requirementListId
      ? await this.db.select().from(schema.requirementList).where(eq(schema.requirementList.id, this.session.requirementListId))
      : [];
    const ids = this.session.documentIds ?? [];
    const documents = ids.length
      ? await this.db
          .select({
            id: schema.projectDocument.id,
            name: schema.projectDocument.name,
            content: schema.projectDocument.content,
            descriptionStatus: schema.projectDocument.descriptionStatus,
          })
          .from(schema.projectDocument)
          .where(inArray(schema.projectDocument.id, ids))
      : [];
    return { ...row!, documents, missingDocuments: ids.length - documents.length, requirementList: requirementList ?? null };
  }

  async participants(onlyActive = true): Promise<Participant[]> {
    const rows = await this.db
      .select()
      .from(schema.councilParticipant)
      .where(eq(schema.councilParticipant.sessionId, this.session.id))
      .orderBy(asc(schema.councilParticipant.position));
    return onlyActive ? rows.filter((p) => p.status === "active") : rows;
  }

  async roles() {
    return this.db.select().from(schema.councilRoleAssignment).where(eq(schema.councilRoleAssignment.sessionId, this.session.id));
  }

  /** Revealed proposals with their newest revision, ordered by neutral label. */
  async proposals(): Promise<ProposalWithLatest[]> {
    const proposals = await this.db.select().from(schema.proposal).where(eq(schema.proposal.sessionId, this.session.id)).orderBy(asc(schema.proposal.label));
    const result: ProposalWithLatest[] = [];
    for (const proposal of proposals) {
      const [latest] = await this.db
        .select()
        .from(schema.proposalRevision)
        .where(eq(schema.proposalRevision.proposalId, proposal.id))
        .orderBy(desc(schema.proposalRevision.version))
        .limit(1);
      if (latest) result.push({ proposal, latest });
    }
    return result;
  }

  async messages(phase?: (typeof schema.councilPhase.enumValues)[number]) {
    const where = phase
      ? and(eq(schema.debateMessage.sessionId, this.session.id), eq(schema.debateMessage.phase, phase))
      : eq(schema.debateMessage.sessionId, this.session.id);
    return this.db.select().from(schema.debateMessage).where(where).orderBy(asc(schema.debateMessage.createdAt));
  }

  async objections() {
    return this.db
      .select()
      .from(schema.minorityObjection)
      .where(eq(schema.minorityObjection.sessionId, this.session.id))
      .orderBy(asc(schema.minorityObjection.createdAt));
  }
}
