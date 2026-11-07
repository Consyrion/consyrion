import { randomBytes } from "node:crypto";
import * as vscode from "vscode";
import { ConsyrionApi, ConsyrionApiError, type ApprovalAction, type ProjectSummary, type SessionSummary } from "./api";
import { renderSessionHtml } from "./html";
import { stateText, translator } from "./i18n";

/** Wording in the chosen language (setting consyrion.language; auto = VS Code display language, de/fr/es or English). */
/** Button labels of the decision view, reused in the confirmation ("reject" was shown raw, QA 07.11.26). */
const ACTION_LABELS: Record<string, string> = { approve: "Approve", reject: "Reject", request_changes: "Request changes", request_more_debate: "More debate" };

const chosenLanguage = () => {
  const setting = vscode.workspace.getConfiguration("consyrion").get<string>("language") ?? "auto";
  return setting === "auto" ? vscode.env.language : setting;
};
const t: ReturnType<typeof translator> = (text, values) => translator(chosenLanguage())(text, values);

const TOKEN_KEY = "consyrion.apiToken";
const FILE_SCHEME = "consyrion";

type Node = { kind: "project"; project: ProjectSummary } | { kind: "session"; session: SessionSummary };

class ProjectsProvider implements vscode.TreeDataProvider<Node> {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;
  constructor(private readonly getApi: () => Promise<ConsyrionApi | null>) {}
  refresh() {
    this.changed.fire();
  }
  getTreeItem(node: Node): vscode.TreeItem {
    if (node.kind === "project") return new vscode.TreeItem(node.project.name, vscode.TreeItemCollapsibleState.Collapsed);
    const item = new vscode.TreeItem(`${node.session.mode.replaceAll("_", " ")} · ${stateText(t, node.session.status)}`);
    item.description = new Date(node.session.createdAt).toLocaleString();
    item.command = { command: "consyrion.openSession", title: t("Open decision"), arguments: [node.session.id] };
    item.iconPath = new vscode.ThemeIcon(
      node.session.status === "awaiting_approval" ? "bell-dot" : node.session.status === "approved" ? "pass" : "circle-outline",
    );
    return item;
  }
  async getChildren(node?: Node): Promise<Node[]> {
    const api = await this.getApi();
    if (!api) return [];
    try {
      if (!node) return (await api.projects()).map((project) => ({ kind: "project", project }));
      if (node.kind === "project") return (await api.sessions(node.project.id)).map((session) => ({ kind: "session", session }));
    } catch (error) {
      void vscode.window.showErrorMessage(`CONSYRION AI: ${error instanceof Error ? error.message : t("request failed")}`);
    }
    return [];
  }
}

/** Read-only virtual documents for generated files and their base versions (diff view). */
class FileContents implements vscode.TextDocumentContentProvider {
  readonly files = new Map<string, string>();
  provideTextDocumentContent(uri: vscode.Uri) {
    return this.files.get(uri.toString()) ?? "";
  }
}

export function activate(context: vscode.ExtensionContext) {
  const getApi = async () => {
    const token = await context.secrets.get(TOKEN_KEY);
    if (!token) return null;
    return new ConsyrionApi(vscode.workspace.getConfiguration("consyrion").get<string>("serverUrl") ?? "https://app.consyrion.com", token);
  };
  const provider = new ProjectsProvider(getApi);
  const contents = new FileContents();
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("consyrion.projects", provider),
    vscode.workspace.registerTextDocumentContentProvider(FILE_SCHEME, contents),

    vscode.commands.registerCommand("consyrion.signIn", async () => {
      const token = await vscode.window.showInputBox({
        prompt: t("Personal API token (CONSYRION AI → Settings → API tokens)"),
        password: true,
        ignoreFocusOut: true,
        validateInput: (v) =>
          v.startsWith("cns_")
            ? null
            : v.startsWith("cni_")
              ? t("This is an integration token; VS Code needs a full-access token (cns_…)")
              : t("Tokens start with cns_"),
      });
      if (!token) return;
      await context.secrets.store(TOKEN_KEY, token);
      try {
        await (await getApi())!.projects();
        void vscode.window.showInformationMessage(`CONSYRION AI: ${t("connected.")}`);
      } catch (error) {
        await context.secrets.delete(TOKEN_KEY);
        void vscode.window.showErrorMessage(`CONSYRION AI: ${error instanceof Error ? error.message : t("sign-in failed")}`);
      }
      provider.refresh();
    }),

    vscode.commands.registerCommand("consyrion.signOut", async () => {
      await context.secrets.delete(TOKEN_KEY);
      provider.refresh();
    }),

    vscode.commands.registerCommand("consyrion.refresh", () => provider.refresh()),

    vscode.commands.registerCommand("consyrion.openSession", async (sessionId?: string) => {
      // From the command palette there is no session: point to the tree instead of failing with "Session not found".
      if (!sessionId) return void vscode.commands.executeCommand("consyrion.projects.focus");
      const api = await getApi();
      if (!api) return vscode.commands.executeCommand("consyrion.signIn");
      const panel = vscode.window.createWebviewPanel("consyrion.session", t("CONSYRION AI decision"), vscode.ViewColumn.One, { enableScripts: true });
      const render = async () => {
        const view = (await api.session(sessionId)) as unknown as Parameters<typeof renderSessionHtml>[0];
        panel.title = `CONSYRION AI · ${view.project.name}`;
        // The server enforces roles; the buttons are shown to everyone and rejected server-side if not allowed.
        panel.webview.html = renderSessionHtml(view, randomBytes(16).toString("base64"), true, t);
      };
      panel.webview.onDidReceiveMessage(async (message: { action: string; comment: string }) => {
        try {
          if (message.action === "report") {
            const doc = await vscode.workspace.openTextDocument({ content: await api.reportMarkdown(sessionId, chosenLanguage()), language: "markdown" });
            await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
          } else if (message.action === "changes") {
            await vscode.commands.executeCommand("consyrion.openChanges", sessionId);
          } else {
            const confirm = await vscode.window.showWarningMessage(
              t('Record "{action}" for this decision?', { action: t(ACTION_LABELS[message.action] ?? message.action.replaceAll("_", " ")) }),
              { modal: true },
              t("Yes"),
            );
            if (confirm !== t("Yes")) return;
            await api.approve(sessionId, message.action as ApprovalAction, message.comment);
            await render();
            provider.refresh();
          }
        } catch (error) {
          void vscode.window.showErrorMessage(
            `CONSYRION AI: ${error instanceof ConsyrionApiError || error instanceof Error ? error.message : t("action failed")}`,
          );
        }
      });
      try {
        await render();
      } catch (error) {
        panel.dispose();
        void vscode.window.showErrorMessage(`CONSYRION AI: ${error instanceof Error ? error.message : t("could not load the decision")}`);
      }
    }),

    vscode.commands.registerCommand("consyrion.openChanges", async (sessionId: string) => {
      const api = await getApi();
      if (!api) return;
      const [latest] = await api.executions(sessionId);
      if (!latest) return void vscode.window.showInformationMessage(`CONSYRION AI: ${t("no Execution Council run for this decision yet.")}`);
      const run = await api.execution(latest.id);
      const changed = run.files.filter((f) => f.changed);
      if (!changed.length) return void vscode.window.showInformationMessage(`CONSYRION AI: ${t("the run produced no changes.")}`);
      const pick = await vscode.window.showQuickPick(
        changed.map((f) => ({ label: f.path, description: f.before === null ? "new" : "modified", file: f })),
        {
          placeHolder: `${t("{n} changed file(s) · run {status}", { n: changed.length, status: stateText(t, run.plan.status) })}${run.plan.pullRequestUrl ? t(" · draft PR available") : ""}`,
        },
      );
      if (!pick) return;
      const right = vscode.Uri.parse(`${FILE_SCHEME}:/${latest.id}/after/${pick.file.path}`);
      const left = vscode.Uri.parse(`${FILE_SCHEME}:/${latest.id}/before/${pick.file.path}`);
      contents.files.set(right.toString(), pick.file.content);
      contents.files.set(left.toString(), pick.file.before ?? "");
      await vscode.commands.executeCommand("vscode.diff", left, right, `${pick.file.path} (Consyrion)`);
    }),
  );
}

export function deactivate() {}
