import { Modal, moment, normalizePath, Notice, Plugin, PluginSettingTab, requestUrl, Setting, type App } from "obsidian";
import { ConsyrionApi, ConsyrionError, FINISHED, validateServerUrl, type Http, type Mode, type ModelChoice, type Participant } from "./api";
import { idempotencyKey, prepareProject, validateTeam } from "./flow";
import { resolveLocale, translator, type Key } from "./i18n";
import { freePath, reportFileName, reportNote } from "./note";

/**
 * CONSYRION AI for Obsidian (#103): send explicitly selected text to a council and save the report as a new note.
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
  serverUrl: "https://app.consyrion.com",
  token: "",
  allowLocalHttp: false,
  folder: "CONSYRION",
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

export default class ConsyrionPlugin extends Plugin {
  settings: Settings = { ...DEFAULTS };
  private statusEl: HTMLElement | null = null;
  private timer: number | null = null;

  t(key: Key, vars: Record<string, string | number> = {}) {
    return translator(resolveLocale(this.settings.language, moment.locale()))(key, vars);
  }

  /** A readable message for any failure, never the token or a request body. */
  explain(error: unknown): string {
    if (error instanceof ConsyrionError) {
      if (error.message.startsWith("instructions:")) return this.t("instructionsFound", { list: error.message.slice("instructions:".length) });
      if (error.kind === "validation" && ["invalid_url", "https_required", "local_http_disabled"].includes(error.message))
        return this.t(`err_${error.message}` as Key);
      return this.t(`err_${error.kind}` as Key, { message: error.message });
    }
    return this.t("err_server", { message: error instanceof Error ? error.message : "unknown" });
  }

  api(): ConsyrionApi {
    if (!this.settings.token.trim()) throw new ConsyrionError("auth", "missing token");
    return new ConsyrionApi(validateServerUrl(this.settings.serverUrl, this.settings.allowLocalHttp), this.settings.token.trim(), obsidianHttp);
  }

  async onload() {
    this.settings = { ...DEFAULTS, ...((await this.loadData()) as Partial<Settings> | null) };
    this.addSettingTab(new ConsyrionSettingTab(this.app, this));
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
    let api: ConsyrionApi;
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
            phase: status.currentPhase ? status.currentPhase.replace(/_/g, " ") : this.t(status.status === "queued" ? "phase_queued" : "phase_running"),
            tokens: `${status.tokensUsed.toLocaleString()} / ${status.tokenBudget.toLocaleString()}`,
          }),
        );
      } catch (error) {
        // Offline or a short server error: keep the run and try again later; a deleted council is dropped.
        if (error instanceof ConsyrionError && (error.kind === "not_found" || error.kind === "auth")) {
          new Notice(this.explain(error));
          if (error.kind === "not_found") await this.dropRun(run);
        }
      }
    }
    this.statusEl?.setText(lines.join(" | "));
    if (this.settings.pending.some((p) => p.sessionId)) this.timer = window.setTimeout(() => void this.poll(), POLL_MS);
  }

  private async finish(api: ConsyrionApi, run: PendingRun, status: Awaited<ReturnType<ConsyrionApi["status"]>>) {
    for (const failure of status.failures) new Notice(this.t("partialFailure", { model: failure.modelId, reason: failure.reason }), 10_000);
    if (status.status === "failed" || status.status === "cancelled") {
      new Notice(this.t("runFailed", { name: status.projectName, status: status.status, error: status.error ?? "" }), 15_000);
      await this.dropRun(run);
      return;
    }
    const report = await api.report(run.sessionId!);
    const folder = normalizePath(this.settings.folder || "CONSYRION");
    if (!this.app.vault.getAbstractFileByPath(folder)) await this.app.vault.createFolder(folder).catch(() => undefined);
    const date = new Date();
    const path = freePath(folder, reportFileName(run.question, date), (p) => Boolean(this.app.vault.getAbstractFileByPath(normalizePath(p))));
    const body = reportNote({
      report,
      sessionId: run.sessionId!,
      serverUrl: validateServerUrl(this.settings.serverUrl, this.settings.allowLocalHttp),
      sourcePath: run.sourcePath,
      models: status.models,
      status: status.status,
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
    private readonly plugin: ConsyrionPlugin,
    private readonly text: string,
    private readonly sourcePath: string | null,
  ) {
    super(app);
    this.budget = plugin.settings.tokenBudget;
    this.question = (text.split("\n").find((l) => l.trim()) ?? "").replace(/^#+\s*/, "").slice(0, 120);
  }

  async onOpen() {
    const t = this.plugin.t.bind(this.plugin);
    this.titleEl.setText(t("modalTitle"));
    const { contentEl } = this;
    contentEl.createEl("p", { text: t("modalSent") });
    // The exact text that will be sent (#103: the preview must match what is transmitted).
    const pre = contentEl.createEl("pre", { cls: "consyrion-preview" });
    pre.setText(this.text);
    pre.style.maxHeight = "12em";
    pre.style.overflow = "auto";
    pre.style.whiteSpace = "pre-wrap";
    new Setting(contentEl).setName(t("modalQuestion")).addText((c) => c.setValue(this.question).onChange((v) => (this.question = v)));
    new Setting(contentEl).setName(t("modalGoal")).addText((c) => c.onChange((v) => (this.goal = v)));
    new Setting(contentEl).setName(t("modalRequirements")).addTextArea((c) => c.onChange((v) => (this.requirements = v)));
    new Setting(contentEl).setName(t("modalMode")).addDropdown((d) =>
      d
        .addOptions({
          independent_expert: t("modes_independent_expert"),
          adversarial_review: t("modes_adversarial_review"),
          consensus: t("modes_consensus"),
        })
        .setValue(this.mode)
        .onChange((v) => (this.mode = v as Mode)),
    );
    new Setting(contentEl)
      .setName(t("modalBudget"))
      .addText((c) => c.setValue(String(this.budget)).onChange((v) => (this.budget = Number(v.replace(/\D/g, "")) || 0)));
    const modelsEl = contentEl.createDiv();
    modelsEl.createEl("h4", { text: t("modalModels") });
    const info = contentEl.createEl("p");
    const actions = new Setting(contentEl);
    try {
      this.choices = (await this.plugin.api().models()).filter((c) => c.models.length);
      if (!this.choices.length) modelsEl.createEl("p", { text: t("noKeys") });
      for (const c of this.choices)
        for (const m of c.models.slice(0, 30)) {
          const value = `${c.credentialId}|${m.modelId}`;
          new Setting(modelsEl)
            .setName(m.displayName || m.modelId)
            .setDesc(`${c.provider} · ${c.label}`)
            .addToggle((tg) =>
              tg.onChange((on) => {
                if (on) this.chosen.add(value);
                else this.chosen.delete(value);
              }),
            );
        }
    } catch (error) {
      info.setText(this.plugin.explain(error));
    }
    let startButton: HTMLButtonElement | null = null;
    actions
      .addButton((b) =>
        b.setButtonText(t("preview")).onClick(async () => {
          if (this.busy) return;
          info.setText(t("previewing"));
          try {
            const result = await this.previewCost();
            info.setText(result);
            startButton?.removeAttribute("disabled");
          } catch (error) {
            info.setText(this.plugin.explain(error));
          }
        }),
      )
      .addToggle((tg) => tg.setTooltip(t("confirmShorten")).onChange((v) => (this.confirmShorten = v)))
      .addButton((b) => {
        startButton = b.buttonEl;
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
              info.setText(this.plugin.explain(error));
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
    if (!validateTeam(participants)) throw new ConsyrionError("validation", t("pickModels"));
    const api = this.plugin.api();
    if (!this.prepared) {
      const { projectId } = await prepareProject(api, {
        question: this.question,
        text: this.text,
        goal: this.goal,
        requirements: this.requirements.split("\n"),
      });
      this.prepared = { projectId, key: "" };
    }
    const preview = await api.preview(this.prepared.projectId, { mode: this.mode, participants, tokenBudget: this.budget });
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
    private readonly plugin: ConsyrionPlugin,
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

class ConsyrionSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private readonly plugin: ConsyrionPlugin,
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
