import * as vscode from "vscode";
import { CompleteResult } from "../api";
import { retryWithHint } from "../retry";

export class ErrorPanel {
  private static ctx: vscode.ExtensionContext;
  private static panel: vscode.WebviewPanel | null = null;

  // NEW: remember which doc to retry against
  private static targetUri: vscode.Uri | null = null;

  /** Call once from activate() */
  static init(ctx: vscode.ExtensionContext) {
    this.ctx = ctx;
  }

  static show(
    ctx: vscode.ExtensionContext,
    logText: string,
    targetUri?: vscode.Uri,
    attemptText?: string
  ) {
    if (!this.ctx) this.ctx = ctx;
    this.targetUri =
      targetUri ??
      vscode.window.activeTextEditor?.document.uri ??
      this.targetUri ??
      null;

    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Beside);
      this.panel.webview.postMessage({
        command: "updateError",
        log: logText,
        attempt: attemptText ?? "",
      });
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      "lean4CopilotError",
      "Lean4 Copilot — Verification Log",
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      { enableScripts: true, retainContextWhenHidden: true }
    );

    this.panel.onDidDispose(
      () => (ErrorPanel.panel = null),
      null,
      this.ctx.subscriptions
    );
    this.panel.webview.html = this.getHtml(
      this.panel.webview,
      logText,
      attemptText ?? ""
    );

    this.panel.webview.onDidReceiveMessage(async (msg) => {
      switch (msg.command) {
        case "retry": {
          const hint: string | undefined =
            typeof msg.hint === "string" ? msg.hint : undefined;
          await this.handleRetry(hint);
          break;
        }
        case "close":
          this.dispose();
          break;
      }
    });
  }

  static dispose() {
    if (this.panel) {
      this.panel.dispose();
      this.panel = null;
    }
  }

  /* ───────────────────────────── Internals ───────────────────────────── */

  private static async handleRetry(userHint?: string) {
    // Use the remembered document, not the active editor (which is the webview)
    const uri =
      this.targetUri ?? vscode.window.activeTextEditor?.document.uri ?? null;
    if (!uri) {
      vscode.window.showWarningMessage(
        "Lean4 Copilot: No active editor to retry."
      );
      return;
    }

    const originalDoc = await vscode.workspace.openTextDocument(uri);
    const fileText = originalDoc.getText();

    const progressTitle = "Lean4 Copilot: Retrying…";
    const result = await vscode.window.withProgress<CompleteResult>(
      { location: vscode.ProgressLocation.Notification, title: progressTitle },
      async (_progress, _token) => {
        try {
          const res = await retryWithHint(fileText, userHint);
          return res; // CompleteResult
        } catch (e: any) {
          return {
            ok: false,
            proof: fileText,
            log: e?.message ?? String(e),
            attempt: null,
          };
        }
      }
    );

    if (!result.ok) {
      this.postToWebview({
        command: "updateError",
        log: result.log || "Verification failed.",
        attempt: result.attempt ?? "",
      });
      return;
    }

    // success unchanged
    this.dispose();
    await this.openDiffWithApplyDiscard(originalDoc, result.proof);
  }

  private static async openDiffWithApplyDiscard(
    originalDoc: vscode.TextDocument,
    proposedText: string
  ) {
    const tempDoc = await vscode.workspace.openTextDocument({
      content: proposedText,
      language: originalDoc.languageId || "lean4",
    });

    await vscode.window.showTextDocument(tempDoc, {
      preview: true,
      preserveFocus: true,
    });

    const title = "Lean4 Copilot: Proposed changes";
    await vscode.commands.executeCommand(
      "vscode.diff",
      originalDoc.uri,
      tempDoc.uri,
      title,
      {
        preview: true,
      }
    );

    const action = await vscode.window.showInformationMessage(
      "Apply Lean4 Copilot changes?",
      { modal: true },
      "Apply",
      "Discard"
    );

    if (action === "Apply") {
      await this.applyFullDocumentEdit(originalDoc, proposedText);
      await this.closeActiveEditorIfDiff();
      await this.focusAndCloseDoc(tempDoc.uri);
      vscode.window.setStatusBarMessage("Lean4 Copilot: Applied.", 2000);
    } else {
      await this.closeActiveEditorIfDiff();
      await this.focusAndCloseDoc(tempDoc.uri);
      vscode.window.setStatusBarMessage("Lean4 Copilot: Discarded.", 2000);
    }
  }

  private static async applyFullDocumentEdit(
    doc: vscode.TextDocument,
    newText: string
  ) {
    const fullRange = new vscode.Range(
      doc.positionAt(0),
      doc.positionAt(doc.getText().length)
    );
    const editor = await vscode.window.showTextDocument(doc, {
      preview: false,
    });
    await editor.edit((eb) => eb.replace(fullRange, newText));
  }

  private static async closeActiveEditorIfDiff() {
    await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
  }

  private static async focusAndCloseDoc(uri: vscode.Uri) {
    const doc = vscode.workspace.textDocuments.find(
      (d) => d.uri.toString() === uri.toString()
    );
    if (!doc) return;
    const editor = vscode.window.visibleTextEditors.find(
      (e) => e.document === doc
    );
    if (editor) {
      await vscode.window.showTextDocument(editor.document, editor.viewColumn);
      await vscode.commands.executeCommand(
        "workbench.action.closeActiveEditor"
      );
    }
  }

  private static postToWebview(message: any) {
    if (this.panel) {
      this.panel.webview.postMessage(message);
    }
  }

  private static getHtml(
    _webview: vscode.Webview,
    logText: string,
    attemptText: string
  ): string {
    const css = `
    :root {
      color-scheme: light dark;
      --pad: 12px; --gap: 12px; --radius: 8px;
      --fg: var(--vscode-foreground);
      --muted: var(--vscode-descriptionForeground);
      --card-bg: var(--vscode-editorWidget-background);
      --card-border: var(--vscode-editorWidget-border);
      --btn-bg: var(--vscode-button-background);
      --btn-fg: var(--vscode-button-foreground);
      --btn-hover: var(--vscode-button-hoverBackground);
      --input-bg: var(--vscode-input-background);
      --input-fg: var(--vscode-input-foreground);
      --input-border: var(--vscode-input-border);
    }

    * { box-sizing: border-box; }
    body {
      font-family: var(--vscode-font-family);
      color: var(--fg);
      margin: 0;
      padding: calc(var(--pad) * 1.25);
      line-height: 1.4;
    }

    h2 {
      margin: 0 0 var(--gap) 0;
      font-weight: 700;
      letter-spacing: .2px;
    }

    .grid {
      display: grid;
      grid-template-columns: 1fr;
      gap: var(--gap);
    }

    .card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: var(--radius);
      padding: var(--pad);
    }

    .card-title {
      font-weight: 600;
      margin-bottom: 8px;
    }

    .mono {
      font-family: var(--vscode-editor-font-family, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace);
      white-space: pre-wrap;
      overflow: auto;
      max-height: 40vh;
      line-height: 1.45;
      padding: 8px;
      background: var(--vscode-editor-background, transparent);
      border: 1px solid var(--card-border);
      border-radius: 6px;
    }

    .muted { color: var(--muted); }

    .input-block {
      display: grid;
      gap: 8px;
    }

    textarea {
      width: 100%;
      min-height: 90px;
      resize: vertical;
      border-radius: 6px;
      border: 1px solid var(--input-border);
      background: var(--input-bg);
      color: var(--input-fg);
      padding: 10px;
      font-family: var(--vscode-editor-font-family, ui-monospace, monospace);
      line-height: 1.45;
    }

    .actions {
      display: flex;
      gap: 8px;
      justify-content: flex-end;
      margin-top: 10px;
    }

    button {
      cursor: pointer;
      border: none;
      border-radius: 6px;
      padding: 6px 12px;
      background: var(--btn-bg);
      color: var(--btn-fg);
    }
    button:hover { background: var(--btn-hover); }

    .row-actions {
      display: flex;
      gap: 8px;
      justify-content: flex-end;
      margin-top: 8px;
    }

    @media (min-width: 920px) {
      .grid {
        grid-template-columns: 1fr 1fr;
      }
    }
  `;

    const js = `
    const vscode = acquireVsCodeApi();

    const attemptEl = document.getElementById('attempt');
    const logEl = document.getElementById('log');
    const hintEl = document.getElementById('hint');

    document.getElementById('retry').addEventListener('click', () => {
      vscode.postMessage({ command: 'retry', hint: hintEl.value });
    });
    document.getElementById('close').addEventListener('click', () => {
      vscode.postMessage({ command: 'close' });
    });

    // Copy helpers
    document.getElementById('copyAttempt').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(attemptEl.textContent || ''); } catch {}
    });
    document.getElementById('copyError').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(logEl.textContent || ''); } catch {}
    });

    // Live updates from extension
    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg?.command === 'updateError') {
        attemptEl.textContent = msg.attempt || '';
        logEl.textContent = msg.log || '';
      }
    });
  `;

    // escape HTML to avoid accidental markup from logs
    const esc = (s: string) =>
      s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

    return `
  <!doctype html>
  <html>
    <head>
      <meta charset="utf-8"/>
      <title>Lean4 Copilot — Verification Log</title>
      <style>${css}</style>
    </head>
    <body>
      <h2>Lean4 Copilot — Verification Log</h2>

      <div class="grid">
        <!-- Model attempt -->
        <section class="card">
          <div class="card-title">Model attempt</div>
          <pre id="attempt" class="mono">${esc(attemptText)}</pre>
          <div class="row-actions">
            <button id="copyAttempt" title="Copy attempt">Copy</button>
          </div>
        </section>

        <!-- Lean error -->
        <section class="card">
          <div class="card-title">Lean error</div>
          <pre id="log" class="mono">${esc(
            logText || "Verification failed."
          )}</pre>
          <div class="row-actions">
            <button id="copyError" title="Copy error">Copy</button>
          </div>
        </section>
      </div>

      <section class="card" style="margin-top:12px;">
        <div class="card-title">Retry with hint <span class="muted">(optional)</span></div>
        <div class="input-block">
          <textarea id="hint" placeholder="e.g., try 'simp' then 'rfl', or rewrite using lemma XYZ"></textarea>
        </div>
        <div class="actions">
          <button id="retry">Retry</button>
          <button id="close">Close</button>
        </div>
      </section>

      <script>${js}</script>
    </body>
  </html>`;
  }
}

/* ─────────────────────────── Utilities ─────────────────────────── */

function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
