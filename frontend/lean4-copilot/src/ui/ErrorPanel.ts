// src/ErrorPanel.ts
import * as vscode from "vscode";
import { retryWithHint } from "../retry";

export class ErrorPanel {
  private static ctx: vscode.ExtensionContext;
  private static panel: vscode.WebviewPanel | null = null;

  /** Call once from activate() */
  static init(ctx: vscode.ExtensionContext) {
    this.ctx = ctx;
  }

  /** Open or reveal the panel with the given log text */
  static show(ctx: vscode.ExtensionContext, logText: string) {
    if (!this.ctx) this.ctx = ctx;
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Beside);
      this.panel.webview.postMessage({ command: "updateLog", log: logText });
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      "lean4CopilotError",
      "Lean4 Copilot — Verification Log",
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      }
    );

    this.panel.onDidDispose(
      () => (ErrorPanel.panel = null),
      null,
      this.ctx.subscriptions
    );

    this.panel.webview.html = this.getHtml(this.panel.webview, logText);

    // Messages FROM webview
    this.panel.webview.onDidReceiveMessage(async (msg) => {
      switch (msg.command) {
        case "retry": {
          const hint: string | undefined =
            typeof msg.hint === "string" ? msg.hint : undefined;
          await this.handleRetry(hint);
          break;
        }
        case "close": {
          this.dispose();
          break;
        }
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
    // Get active file text (extension host side, not from webview)
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage(
        "Lean4 Copilot: No active editor to retry."
      );
      return;
    }
    const originalDoc = editor.document;
    const fileText = originalDoc.getText();

    const progressTitle = "Lean4 Copilot: Retrying…";
    const result = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: progressTitle },
      async () => {
        try {
          const res = await retryWithHint(fileText, userHint);
          return res; // { ok, proof, log }
        } catch (e: any) {
          return { ok: false, proof: fileText, log: e?.message ?? String(e) };
        }
      }
    );

    if (!result.ok) {
      // Update log in the panel
      this.postToWebview({
        command: "updateLog",
        log: result.log || "Verification failed.",
      });
      return;
    }

    // Success: close the panel and open the diff with Apply/Discard
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

  private static getHtml(webview: vscode.Webview, logText: string): string {
    // Basic styles inline for portability
    const css = `
      :root { color-scheme: light dark; --pad: 12px; --gap: 10px; }
      body { font-family: var(--vscode-font-family); margin: 0; padding: var(--pad); }
      h2 { margin: 0 0 var(--gap) 0; font-weight: 600; }
      .box { border: 1px solid var(--vscode-editorWidget-border);
             background: var(--vscode-editorWidget-background);
             padding: var(--pad); border-radius: 8px; }
      textarea { width: 100%; box-sizing: border-box; min-height: 64px; }
      pre { white-space: pre-wrap; margin: 0; max-height: 40vh; overflow: auto; }
      .row { display: flex; gap: var(--gap); align-items: center; margin-top: var(--gap); }
      button { padding: 6px 12px; }
      .hintlabel { font-size: 12px; opacity: .8; margin-bottom: 6px; display:block; }
    `;

    const js = `
      const vscode = acquireVsCodeApi();

      const logEl = document.getElementById('log');
      const hintEl = document.getElementById('hint');
      const retryBtn = document.getElementById('retry');
      const closeBtn = document.getElementById('close');

      window.addEventListener('message', (event) => {
        const msg = event.data;
        if (msg?.command === 'updateLog') {
          logEl.textContent = msg.log || '';
        }
      });

      retryBtn.addEventListener('click', () => {
        const hint = hintEl.value;
        vscode.postMessage({ command: 'retry', hint });
      });

      closeBtn.addEventListener('click', () => {
        vscode.postMessage({ command: 'close' });
      });
    `;

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8" />
        <style>${css}</style>
        <title>Lean4 Copilot — Verification Log</title>
      </head>
      <body>
        <h2>Lean4 Copilot — Verification Log</h2>
        <div class="box"><pre id="log">${escapeHtml(logText)}</pre></div>

        <div class="row" style="flex-direction: column; align-items: stretch;">
          <label class="hintlabel" for="hint">Retry with hint (optional):</label>
        <textarea id="hint" placeholder="e.g., try using &grave;simp: any&grave; then &grave;rfl&grave;, or rewrite using lemma XYZ"></textarea>
</div>

        <div class="row">
          <button id="retry">Retry</button>
          <button id="close">Close</button>
        </div>

        <script>${js}</script>
      </body>
      </html>
    `;

    return html;
  }
}

/* ─────────────────────────── Utilities ─────────────────────────── */

function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
