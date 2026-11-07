import { stateText, translator, type T } from "./i18n";

/** Escapes text for the webview HTML. All server data is untrusted. */
export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const PHASES: Record<string, string> = {
  independent_thinking: "Independent Thinking",
  open_council: "Open Council",
  twelve_minds_council: "12 Minds Council",
  minority_review: "Minority Review",
  consensus_round: "Consensus Round",
  final_verdict: "Final Verdict",
  execution_council: "Execution Council",
};

interface SessionViewLike {
  session: { id: string; status: string; mode: string };
  project: { name: string };
  stages: Array<{ phase: string; status: string }>;
  proposals: Array<{ id: string; label: string; revisions: Array<{ content: { title?: string; summary?: string } }> }>;
  objections: Array<{ proposalId: string; status: string; severity: string; category: string; claim: string; blocking: boolean }>;
  decision: { outcome: string; recommendedProposalId: string | null } | null;
  /** Computed by the server (#181, stage 1); the extension only displays it. Missing = not approvable here. */
  decisionStatus?: { approvable: boolean; reason: string | null; canApproveRecommendation: boolean } | null;
}

const OUTCOME_TEXT: Record<string, string> = {
  recommended: "Recommended solution",
  tie: "Tie – choose in the web app",
  no_qualifying_solution: "No solution meets the requirements",
  insufficient_evidence: "Insufficient independent evidence",
};

/** Verdict line: unknown outcomes and anything the server marks as not approvable get a neutral text, never a recommendation. */
function verdictText(view: SessionViewLike, t: T): string {
  const status = view.decisionStatus;
  if (!view.decision) return t("No verdict yet.");
  if (!status || !status.approvable) return t(status?.reason ?? "This verdict cannot be approved or built here.");
  return t(OUTCOME_TEXT[view.decision.outcome] ?? "This verdict cannot be approved or built here.");
}

/** Renders the decision summary for the webview (strict CSP, nonce for the one script). */
export function renderSessionHtml(view: SessionViewLike, nonce: string, canAct: boolean, t: T = translator("en")): string {
  const label = (id: string | null) => view.proposals.find((p) => p.id === id)?.label ?? "?";
  const latest = (p: SessionViewLike["proposals"][number]) => p.revisions[p.revisions.length - 1]?.content ?? {};
  const recommended = view.proposals.find((p) => p.id === view.decision?.recommendedProposalId);
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);padding:12px}.badge{display:inline-block;border:1px solid var(--vscode-panel-border);border-radius:9px;padding:0 6px;margin-right:4px;font-size:11px}li{margin:4px 0}button{margin-right:6px}textarea{width:100%}</style>
</head><body>
<h2>${escapeHtml(view.project.name)}</h2>
<p><span class="badge">${escapeHtml(view.session.mode)}</span><span class="badge">${escapeHtml(stateText(t, view.session.status))}</span></p>
<h3>${escapeHtml(t("Phases"))}</h3><ol>${view.stages.map((s) => `<li>${escapeHtml(PHASES[s.phase] ?? s.phase)} – ${escapeHtml(stateText(t, s.status))}</li>`).join("")}</ol>
<h3>${escapeHtml(t("Verdict"))}</h3>${
    view.decision
      ? `<p>${escapeHtml(verdictText(view, t))}${recommended ? `: <strong>${escapeHtml(t("Proposal {label}", { label: recommended.label }))} – ${escapeHtml(latest(recommended).title)}</strong></p><p>${escapeHtml(latest(recommended).summary)}` : ""}</p>`
      : `<p>${escapeHtml(t("No verdict yet."))}</p>`
  }
<h3>${escapeHtml(t("Objections (Minority Review)"))}</h3><ul>${
    // The status belongs to the objection, not to the proposal it attacks (#169).
    view.objections
      .map(
        (o) =>
          `<li><span class="badge">${escapeHtml(t(`objection ${o.status}`))}</span>${escapeHtml(t("Objection against Proposal {label}", { label: label(o.proposalId) }))} (${escapeHtml(o.category)}/${escapeHtml(o.severity)})${o.blocking ? ` <strong>${escapeHtml(t("blocks approval"))}</strong>` : ""}: ${escapeHtml(o.claim)}</li>`,
      )
      .join("") || `<li>${escapeHtml(t("none"))}</li>`
  }</ul>
${
  canAct && view.session.status === "awaiting_approval"
    ? `<h3>${escapeHtml(t("Your decision"))}</h3><textarea id="comment" rows="3" placeholder="${escapeHtml(t("Comment or reason"))}"></textarea><p>
${view.decisionStatus?.canApproveRecommendation ? `<button data-action="approve">${escapeHtml(t("Approve"))}</button>` : `<em>${escapeHtml(t("Not approvable here."))}</em> `}<button data-action="request_more_debate">${escapeHtml(t("More debate"))}</button><button data-action="request_changes">${escapeHtml(t("Request changes"))}</button><button data-action="reject">${escapeHtml(t("Reject"))}</button></p>`
    : ""
}
<p><button data-action="report">${escapeHtml(t("Open report"))}</button><button data-action="changes">${escapeHtml(t("Open generated changes"))}</button></p>
<script nonce="${nonce}">const vscode=acquireVsCodeApi();document.querySelectorAll("button[data-action]").forEach(b=>b.addEventListener("click",()=>vscode.postMessage({action:b.dataset.action,comment:(document.getElementById("comment")||{}).value||""})));</script>
</body></html>`;
}
