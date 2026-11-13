import { MarkdownView, Modal, moment, normalizePath, Notice, Plugin, PluginSettingTab, requestUrl, Setting, type App } from "obsidian";
import { ConsyriumApi, ConsyriumError, FINISHED, refusedModels, validateServerUrl, type Http, type Mode, type ModelChoice, type Participant } from "./api";
import { checkCallback, CONNECT_ACTION, redeemCode, startConnect, type PendingConnect } from "./connect";
import { idempotencyKey, initialQuestion, matchesModelFilter, prepareProject, suggestRequirements, validateTeam } from "./flow";
import { resolveLocale, translator, type Key } from "./i18n";
import { answerBlock, freePath, reportFileName, reportLeadsWithAnswer, reportNote } from "./note";

/**
 * CONSYRIUM AI for Obsidian (#103): send explicitly selected text to a council and save the report as a new note.
 * Talks only to the configured server with an integration token; reads nothing from the vault except the text the user
 * selected (shown before sending); never approves, builds or merges.
 */

interface PendingRun {
  /** Prepared project – reused on a retry, so a timeout never creates a second project or council. */
  projectId: string;
  idempotencyKey: string;
  sessionId: string | null;
  question: string;
  sourcePath: string | null;
  startedAt: string;
}

interface Settings {
  serverUrl: string;
  token: string;
  allowLocalHttp: boolean;
  folder: string;
  tokenBudget: number;
  language: "auto" | "en" | "de";
  pending: PendingRun[];
}

const DEFAULTS: Settings = {
  serverUrl: "https://app.consyrium.com",
  token: "",
  allowLocalHttp: false,
  folder: "CONSYRIUM",
  tokenBudget: 300_000,
  language: "auto",
  pending: [],
};

const POLL_MS = 8_000;

/** Obsidian's requestUrl (no CORS limits, works on desktop and mobile); errors become a status, never a throw. */
const obsidianHttp: Http = async (request) => {
  const response = await requestUrl({ url: request.url, method: request.method, headers: request.headers, body: request.body, throw: false });
  return { status: response.status, text: response.text };
};

const PHASES = ["independent_thinking", "open_council", "twelve_minds_council", "minority_review", "consensus_round", "final_verdict", "execution_council"];

/** The official phase name, with a short explanation in the interface language; unknown phases are shown as sent. */
function phaseLabel(t: (key: Key) => string, phase: string): string {
  return PHASES.includes(phase) ? t(`phaseName_${phase}` as Key) : phase.replace(/_/g, " ");
}

export default class ConsyriumPlugin extends Plugin {
  settings: Settings = { ...DEFAULTS };
  private statusEl: HTMLElement | null = null;
  private timer: number | null = null;
  private settingTab: ConsyriumSettingTab | null = null;
  /** A sign-in started with "Connect" that has not come back yet. Memory only: state and PKCE secret never reach data.json. */
  private pendingConnect: PendingConnect | null = null;

  t(key: Key, vars: Record<string, string | number> = {}) {
    return translator(resolveLocale(this.settings.language, moment.locale()))(key, vars);
  }

  /** A readable message for any failure, never the token or a request body. */
  explain(error: unknown): string {
    if (error instanceof ConsyriumError) {
      const refused = error.message.startsWith("unusable:") ? error.message.slice("unusable:".length) : refusedModels(error.message);
      if (refused) return this.t("modelsRefused", { list: refused });
      if (error.message.startsWith("instructions:")) return this.t("instructionsFound", { list: error.message.slice("instructions:".length) });
      if (error.kind === "validation" && ["invalid_url", "https_required", "local_http_disabled"].includes(error.message))
        return this.t(`err_${error.message}` as Key);
      return this.t(`err_${error.kind}` as Key, { message: error.message });
    }
    return this.t("err_server", { message: error instanceof Error ? error.message : "unknown" });
  }

  api(): ConsyriumApi {
    if (!this.settings.token.trim()) throw new ConsyriumError("auth", "missing token");
    return new ConsyriumApi(validateServerUrl(this.settings.serverUrl, this.settings.allowLocalHttp), this.settings.token.trim(), obsidianHttp);
  }

  async onload() {
    this.settings = { ...DEFAULTS, ...((await this.loadData()) as Partial<Settings> | null) };
    this.settingTab = new ConsyriumSettingTab(this.app, this);
    this.addSettingTab(this.settingTab);
    // The browser comes back through obsidian://consyrium-auth after the user allowed (or denied) the connection.
    this.registerObsidianProtocolHandler(CONNECT_ACTION, (params) => void this.finishConnect(params));
    this.statusEl = this.addStatusBarItem();
    this.addCommand({
      id: "consult-selection",
      name: this.t("commandSelection"),
      editorCallback: (editor, view) => {
        const text = editor.getSelection();
        if (!text.trim()) return void new Notice(this.t("noSelection"));
        this.openConsult(text, view.file?.path ?? null);
      },
    });
    this.addCommand({
      id: "consult-note",
      name: this.t("commandNote"),
      editorCallback: (editor, view) => this.openConsult(editor.getValue(), view.file?.path ?? null),
    });
    // Two ways in for people who do not use the command palette: the right-click menu of the editor and a ribbon icon.
    this.registerEvent(
      this.app.workspace.on("editor-menu", (menu, editor, info) => {
        const selection = editor.getSelection();
        menu.addItem((item) =>
          item
            .setTitle(this.t(selection.trim() ? "commandSelection" : "commandNote"))
            .setIcon("messages-square")
            .onClick(() => this.openConsult(selection.trim() ? selection : editor.getValue(), info.file?.path ?? null)),
        );
      }),
    );
    this.addRibbonIcon("messages-square", this.t("commandSelection"), () => {
      const view = this.app.workspace.getActiveViewOfType(MarkdownView);
      const text = view?.editor.getSelection() ?? "";
      if (!view || !text.trim()) return void new Notice(this.t("noSelection"));
      this.openConsult(text, view.file?.path ?? null);
    });
    this.addCommand({ id: "show-runs", name: this.t("commandResume"), callback: () => new RunsModal(this.app, this).open() });
    // Runs started before a restart continue – the plugin only polls, it never starts a new paid run by itself.
    this.app.workspace.onLayoutReady(() => this.poll());
  }

  onunload() {
    if (this.timer !== null) window.clearTimeout(this.timer);
  }

  async save() {
    await this.saveData(this.settings);
  }

  /**
   * "Connect with CONSYRIUM AI": opens the consent page of the configured server in the browser. The server address is
   * validated like for every other call; state and PKCE secret stay in memory for ten minutes.
   */
  async beginConnect() {
    try {
      const server = validateServerUrl(this.settings.serverUrl, this.settings.allowLocalHttp);
      const { pending, url } = await startConnect(server);
      this.pendingConnect = pending;
      window.open(url);
      new Notice(this.t("connectOpened"), 10_000);
    } catch (error) {
      new Notice(this.explain(error));
    }
  }

  /** Answer of the consent page. Only an answer to the request started here is used; the code is redeemed once. */
  private async finishConnect(params: Record<string, string | undefined>) {
    const pending = this.pendingConnect;
    const result = checkCallback(pending, params);
    if (!result.ok) {
      // An answer that does not belong to the running request must not be able to cancel it.
      if (result.reason !== "unexpected") this.pendingConnect = null;
      const key = ({ unexpected: "connectUnexpected", expired: "connectExpired", denied: "connectDenied", failed: "connectFailed" } as const)[result.reason];
      return void new Notice(this.t(key, { message: result.detail ?? "" }), 10_000);
    }
    this.pendingConnect = null;
    try {
      this.settings.token = await redeemCode(obsidianHttp, pending!, result.code);
      await this.save();
      new Notice(this.t("connectDone"));
      // Show the new state when the settings are open (the tab's element is attached only while it is shown).
      if (this.settingTab?.containerEl.isConnected) this.settingTab.display();
      void this.poll();
    } catch (error) {
      const message = error instanceof ConsyriumError && error.kind === "auth" ? error.message : this.explain(error);
      new Notice(this.t("connectFailed", { message }), 10_000);
    }
  }

  openConsult(text: string, sourcePath: string | null) {
    if (!this.settings.token.trim()) return void new Notice(this.t("notConfigured"));
    new ConsultModal(this.app, this, text, sourcePath).open();
  }

  /** Polls every running council; saves the report as a new note when one is finished. */
  async poll() {
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = null;
    const running = this.settings.pending.filter((p) => p.sessionId);
    if (!running.length || !this.settings.token.trim()) {
      this.statusEl?.setText("");
      return;
    }
    let api: ConsyriumApi;
    try {
      api = this.api();
    } catch {
      return;
    }
    const lines: string[] = [];
    for (const run of running) {
      try {
        const status = await api.status(run.sessionId!);
        if (FINISHED.has(status.status)) {
          await this.finish(api, run, status);
          continue;
        }
        lines.push(
          this.t("statusBar", {
            phase: status.currentPhase
              ? phaseLabel(this.t.bind(this), status.currentPhase)
              : this.t(status.status === "queued" ? "phase_queued" : "phase_running"),
            tokens: `${status.tokensUsed.toLocaleString()} / ${status.tokenBudget.toLocaleString()}`,
          }),
        );
      } catch (error) {
        // Offline or a short server error: keep the run and try again later; a deleted council is dropped.
        if (error instanceof ConsyriumError && (error.kind === "not_found" || error.kind === "auth")) {
          new Notice(this.explain(error));
          if (error.kind === "not_found") await this.dropRun(run);
        }
      }
    }
    this.statusEl?.setText(lines.join(" | "));
    if (this.settings.pending.some((p) => p.sessionId)) this.timer = window.setTimeout(() => void this.poll(), POLL_MS);
  }

  private async finish(api: ConsyriumApi, run: PendingRun, status: Awaited<ReturnType<ConsyriumApi["status"]>>) {
    for (const failure of status.failures) new Notice(this.t("partialFailure", { model: failure.modelId, reason: failure.reason }), 10_000);
    if (status.status === "failed" || status.status === "cancelled") {
      new Notice(this.t("runFailed", { name: status.projectName, status: status.status, error: status.error ?? "" }), 15_000);
      await this.dropRun(run);
      return;
    }
    const report = await api.report(run.sessionId!);
    // The answer first; when the structured report cannot be read the note simply starts with the full report.
    const recommendation = await api.recommendation(run.sessionId!).catch(() => null);
    const folder = normalizePath(this.settings.folder || "CONSYRIUM");
    if (!this.app.vault.getAbstractFileByPath(folder)) await this.app.vault.createFolder(folder).catch(() => undefined);
    const date = new Date();
    const path = freePath(folder, reportFileName(run.question, date), (p) => Boolean(this.app.vault.getAbstractFileByPath(normalizePath(p))));
    const body = reportNote({
      report,
      // Newer servers put the answer first themselves; it must not stand in the note twice.
      answer: reportLeadsWithAnswer(report, recommendation)
        ? ""
        : answerBlock(recommendation, { heading: this.t("answerHeading"), proposal: this.t("answerProposal"), fullReport: this.t("answerFullReport") }),
      sessionId: run.sessionId!,
      serverUrl: validateServerUrl(this.settings.serverUrl, this.settings.allowLocalHttp),
      sourcePath: run.sourcePath,
      models: status.models,
      status: status.status,
      statusLabel: FINISHED.has(status.status) ? this.t(`status_${status.status}` as Key) : status.status,
      date,
      labels: {
        source: this.t("reportSource"),
        run: this.t("reportRun"),
        models: this.t("reportModels"),
        date: this.t("reportDate"),
        status: this.t("reportStatus"),
      },
    });
    // create() refuses an existing path, so even a race never overwrites a note.
    await this.app.vault.create(path, body);
    new Notice(this.t("runFinished", { name: status.projectName, path }), 15_000);
    await this.dropRun(run);
  }

  async dropRun(run: PendingRun) {
    this.settings.pending = this.settings.pending.filter((p) => p !== run && p.idempotencyKey !== run.idempotencyKey);
    await this.save();
  }
}

class ConsultModal extends Modal {
  private choices: ModelChoice[] = [];
  private chosen = new Set<string>();
  private mode: Mode = "independent_expert";
  private budget: number;
  private question: string;
  private goal = "";
  private requirements = "";
  private confirmShorten = false;
  private busy = false;
  private prepared: { projectId: string; key: string } | null = null;

  constructor(
    app: App,
    private readonly plugin: ConsyriumPlugin,
    private readonly text: string,
    private readonly sourcePath: string | null,
  ) {
    super(app);
    this.budget = plugin.settings.tokenBudget;
    this.question = initialQuestion(text);
  }

  async onOpen() {
    const t = this.plugin.t.bind(this.plugin);
    this.titleEl.setText(t("modalTitle"));
    const { contentEl } = this;
    contentEl.createEl("p", { text: t("modalSent") });
    // The exact text that will be sent (#103: the preview must match what is transmitted).
    const pre = contentEl.createEl("pre", { cls: "consyrium-preview" });
    pre.setText(this.text);
    pre.style.maxHeight = "12em";
    pre.style.overflow = "auto";
    pre.style.whiteSpace = "pre-wrap";
    new Setting(contentEl)
      .setName(t("modalQuestion"))
      .setDesc(t("modalQuestionDesc"))
      .addText((c) =>
        c
          .setPlaceholder(t("modalQuestionPlaceholder"))
          .setValue(this.question)
          .onChange((v) => (this.question = v)),
      );
    new Setting(contentEl).setName(t("modalGoal")).addText((c) => c.onChange((v) => (this.goal = v)));
    // Requirement lines the selection itself lists are proposed here; nothing is confirmed that the user did not see.
    this.requirements = suggestRequirements(this.text).join("\n");
    new Setting(contentEl)
      .setName(t("modalRequirements"))
      .setDesc(this.requirements ? t("modalRequirementsSuggested") : "")
      .addTextArea((c) => {
        c.setValue(this.requirements).onChange((v) => (this.requirements = v));
        c.inputEl.rows = 4;
      });
    // The mode names are product names (same as in the web app); the line below says what the mode does.
    const modeSetting = new Setting(contentEl).setName(t("modalMode")).setDesc(t(`modeHelp_${this.mode}`));
    modeSetting.addDropdown((d) =>
      d
        .addOptions({
          independent_expert: t("modes_independent_expert"),
          adversarial_review: t("modes_adversarial_review"),
          consensus: t("modes_consensus"),
        })
        .setValue(this.mode)
        .onChange((v) => {
          this.mode = v as Mode;
          modeSetting.setDesc(t(`modeHelp_${this.mode}`));
        }),
    );
    new Setting(contentEl)
      .setName(t("modalBudget"))
      .addText((c) => c.setValue(String(this.budget)).onChange((v) => (this.budget = Number(v.replace(/\D/g, "")) || 0)));
    const modelsEl = contentEl.createDiv();
    modelsEl.createEl("h4", { text: t("modalModels") });
    const info = contentEl.createEl("p");
    // Errors must not look like the estimate: red and bold, so a refused model is not overlooked above the buttons.
    const show = (text: string, isError = false) => {
      info.setText(text);
      info.style.color = isError ? "var(--text-error)" : "";
      info.style.fontWeight = isError ? "600" : "";
    };
    // Any change of the team makes the last cost check stale: the start is locked until it ran again.
    let lockStart: () => void = () => {};
    new Setting(contentEl).setName(t("confirmShorten")).addToggle((tg) => tg.onChange((v) => (this.confirmShorten = v)));
    const actions = new Setting(contentEl);
    try {
      this.choices = (await this.plugin.api().models()).filter((c) => c.models.length);
      if (!this.choices.length) modelsEl.createEl("p", { text: t("noKeys") });
      // Grouped by key, with a filter and a counter: workspaces with many keys list well over a hundred models.
      const rows: { el: HTMLElement; group: HTMLElement; value: string; model: { name: string; provider: string; label: string } }[] = [];
      const counter = modelsEl.createEl("p");
      const showCount = () => counter.setText(t("modelsChosen", { n: this.chosen.size }));
      showCount();
      let query = "";
      let onlyChosen = false;
      const applyFilter = () => {
        const shownGroups = new Set<HTMLElement>();
        for (const row of rows) {
          const match = matchesModelFilter(query, row.model) && (!onlyChosen || this.chosen.has(row.value));
          row.el.toggle(match);
          if (match) shownGroups.add(row.group);
        }
        for (const group of new Set(rows.map((r) => r.group))) group.toggle(shownGroups.has(group));
      };
      if (this.choices.length) {
        new Setting(modelsEl).setName(t("modelSearch")).addText((c) =>
          c.setPlaceholder(t("modelSearchPlaceholder")).onChange((v) => {
            query = v;
            applyFilter();
          }),
        );
        new Setting(modelsEl).setName(t("modelsOnlyChosen")).addToggle((tg) =>
          tg.onChange((v) => {
            onlyChosen = v;
            applyFilter();
          }),
        );
      }
      for (const c of this.choices) {
        const group = modelsEl.createDiv();
        group.createEl("h5", { text: `${c.provider} · ${c.label}` });
        for (const m of c.models.slice(0, 30)) {
          const value = `${c.credentialId}|${m.modelId}`;
          const name = m.displayName || m.modelId;
          const setting = new Setting(group).setName(name).addToggle((tg) =>
            tg.onChange((on) => {
              if (on) this.chosen.add(value);
              else this.chosen.delete(value);
              showCount();
              lockStart();
            }),
          );
          rows.push({ el: setting.settingEl, group, value, model: { name, provider: c.provider, label: c.label } });
        }
      }
    } catch (error) {
      show(this.plugin.explain(error), true);
    }
    // Obsidian's ButtonComponent ignores clicks while its own `disabled` flag is set, so the button must be enabled
    // through the component (setDisabled), not by removing the DOM attribute.
    let startButton: { setDisabled(disabled: boolean): unknown } | null = null;
    actions
      .addButton((b) =>
        b.setButtonText(t("preview")).onClick(async () => {
          if (this.busy) return;
          show(t("previewing"));
          try {
            const result = await this.previewCost();
            show(result);
            startButton?.setDisabled(false);
          } catch (error) {
            startButton?.setDisabled(true);
            show(this.plugin.explain(error), true);
          }
        }),
      )
      .addButton((b) => {
        startButton = b;
        lockStart = () => b.setDisabled(true);
        b.setButtonText(t("start"))
          .setCta()
          .setDisabled(true)
          .onClick(async () => {
            if (this.busy) return;
            this.busy = true;
            b.setDisabled(true).setButtonText(t("starting"));
            try {
              const id = await this.start();
              new Notice(t("started", { id }));
              this.close();
              void this.plugin.poll();
            } catch (error) {
              show(this.plugin.explain(error), true);
              b.setDisabled(false).setButtonText(t("start"));
            } finally {
              this.busy = false;
            }
          });
      });
  }

  private participants(): Participant[] {
    return [...this.chosen].map((v) => {
      const [credentialId, ...rest] = v.split("|");
      return { credentialId: credentialId!, modelId: rest.join("|") };
    });
  }

  /** Creates the project once (reused for later previews and the start) and returns the estimate in words. */
  private async previewCost(): Promise<string> {
    const t = this.plugin.t.bind(this.plugin);
    const participants = this.participants();
    if (!this.question.trim()) throw new ConsyriumError("validation", t("questionMissing"));
    if (!validateTeam(participants)) throw new ConsyriumError("validation", t("pickModels"));
    const api = this.plugin.api();
    if (!this.prepared) {
      const { projectId } = await prepareProject(api, {
        question: this.question,
        text: this.text,
        goal: this.goal,
        requirements: this.requirements.split("\n"),
        excludedReason: t("contextReason"),
      });
      this.prepared = { projectId, key: "" };
    }
    const preview = await api.preview(this.prepared.projectId, { mode: this.mode, participants, tokenBudget: this.budget });
    if (preview.unusableModels?.length) {
      const names = preview.unusableModels.map((m) => m.modelId).join(", ");
      throw new ConsyriumError("provider", `unusable:${names}`);
    }
    const f = (n: number | undefined) => (n === undefined ? "–" : n.toLocaleString());
    const parts = [
      t("previewResult", { upper: f(preview.estimate.upperBound), typical: f(preview.estimate.typical?.tokens), minimum: f(preview.estimate.minimumBudget) }),
      preview.estimate.upperBound > this.budget ? t("previewOverBudget") : "",
      preview.planLimit ?? "",
      preview.finalVerdictSize?.message ?? "",
      ...(preview.modelWarnings ?? []).map((w) => (typeof w === "string" ? w : (w.message ?? ""))),
    ];
    return parts.filter(Boolean).join(" ");
  }

  /** Starts once: the pending run is saved before the call, the Idempotency-Key makes a retry return the same council. */
  private async start(): Promise<string> {
    const participants = this.participants();
    if (!this.prepared) await this.previewCost();
    const api = this.plugin.api();
    const key = idempotencyKey(this.prepared!.projectId, this.mode, participants, this.budget);
    let run = this.plugin.settings.pending.find((p) => p.idempotencyKey === key);
    if (!run) {
      run = {
        projectId: this.prepared!.projectId,
        idempotencyKey: key,
        sessionId: null,
        question: this.question,
        sourcePath: this.sourcePath,
        startedAt: new Date().toISOString(),
      };
      this.plugin.settings.pending.push(run);
      await this.plugin.save();
    }
    const { session } = await api.start(
      this.prepared!.projectId,
      { mode: this.mode, participants, tokenBudget: this.budget, confirmBudget: this.confirmShorten },
      key,
    );
    run.sessionId = session.id;
    await this.plugin.save();
    return session.id;
  }

  onClose() {
    this.contentEl.empty();
    // A prepared but never started run is not kept (no council was started, nothing to resume).
    this.plugin.settings.pending = this.plugin.settings.pending.filter((p) => p.sessionId);
    void this.plugin.save();
  }
}

class RunsModal extends Modal {
  constructor(
    app: App,
    private readonly plugin: ConsyriumPlugin,
  ) {
    super(app);
  }

  onOpen() {
    const t = this.plugin.t.bind(this.plugin);
    this.titleEl.setText(t("running"));
    const runs = this.plugin.settings.pending.filter((p) => p.sessionId);
    if (!runs.length) this.contentEl.createEl("p", { text: t("noRuns") });
    let server = "";
    try {
      server = validateServerUrl(this.plugin.settings.serverUrl, this.plugin.settings.allowLocalHttp);
    } catch {
      /* shown in settings */
    }
    for (const run of runs) {
      new Setting(this.contentEl)
        .setName(run.question)
        .setDesc(`${run.sessionId} · ${run.startedAt.slice(0, 16).replace("T", " ")}`)
        .addButton((b) => b.setButtonText(t("open")).onClick(() => window.open(`${server}/sessions/${run.sessionId}`)))
        .addButton((b) =>
          b.setButtonText(t("cancelRun")).onClick(async () => {
            try {
              await this.plugin.api().cancel(run.sessionId!);
              new Notice(t("cancelled"));
            } catch (error) {
              new Notice(this.plugin.explain(error));
            }
          }),
        );
    }
  }

  onClose() {
    this.contentEl.empty();
  }
}

class ConsyriumSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private readonly plugin: ConsyriumPlugin,
  ) {
    super(app, plugin);
  }

  display() {
    const t = this.plugin.t.bind(this.plugin);
    const { containerEl } = this;
    containerEl.empty();
    new Setting(containerEl)
      .setName(t("settingsServer"))
      .setDesc(t("settingsServerDesc"))
      .addText((c) =>
        c.setValue(this.plugin.settings.serverUrl).onChange(async (v) => {
          this.plugin.settings.serverUrl = v;
          await this.plugin.save();
        }),
      );
    // Signing in is the normal way; the token field below stays as the alternative. Obsidian's ButtonComponent ignores
    // clicks while its own `disabled` flag is set, so the button is locked and released through setDisabled only.
    new Setting(containerEl)
      .setName(t("connectName"))
      .setDesc(t(this.plugin.settings.token ? "connectDescConnected" : "connectDesc"))
      .addButton((b) =>
        b
          .setButtonText(t("connectButton"))
          .setCta()
          .onClick(async () => {
            b.setDisabled(true);
            try {
              await this.plugin.beginConnect();
            } finally {
              b.setDisabled(false);
            }
          }),
      );
    new Setting(containerEl)
      .setName(t("settingsToken"))
      .setDesc(t("settingsTokenDesc"))
      .addText((c) => {
        c.inputEl.type = "password";
        c.setPlaceholder("cni_…")
          .setValue(this.plugin.settings.token)
          .onChange(async (v) => {
            this.plugin.settings.token = v.trim();
            await this.plugin.save();
          });
      })
      .addButton((b) =>
        b.setButtonText(t("settingsTokenRemove")).onClick(async () => {
          this.plugin.settings.token = "";
          await this.plugin.save();
          this.display();
        }),
      );
    new Setting(containerEl)
      .setName(t("settingsLocal"))
      .setDesc(t("settingsLocalDesc"))
      .addToggle((tg) =>
        tg.setValue(this.plugin.settings.allowLocalHttp).onChange(async (v) => {
          this.plugin.settings.allowLocalHttp = v;
          await this.plugin.save();
        }),
      );
    new Setting(containerEl)
      .setName(t("settingsFolder"))
      .setDesc(t("settingsFolderDesc"))
      .addText((c) =>
        c.setValue(this.plugin.settings.folder).onChange(async (v) => {
          this.plugin.settings.folder = v;
          await this.plugin.save();
        }),
      );
    new Setting(containerEl).setName(t("settingsBudget")).addText((c) =>
      c.setValue(String(this.plugin.settings.tokenBudget)).onChange(async (v) => {
        this.plugin.settings.tokenBudget = Number(v.replace(/\D/g, "")) || DEFAULTS.tokenBudget;
        await this.plugin.save();
      }),
    );
    new Setting(containerEl).setName(t("settingsLanguage")).addDropdown((d) =>
      d
        .addOptions({ auto: "Auto", en: "English", de: "Deutsch" })
        .setValue(this.plugin.settings.language)
        .onChange(async (v) => {
          this.plugin.settings.language = v as Settings["language"];
          await this.plugin.save();
          this.display();
        }),
    );
    new Setting(containerEl).addButton((b) =>
      b.setButtonText(t("settingsTest")).onClick(async () => {
        try {
          const models = await this.plugin.api().models();
          new Notice(t("testOk", { n: models.filter((m) => m.models.length).length }));
        } catch (error) {
          new Notice(this.plugin.explain(error));
        }
      }),
    );
  }
}
