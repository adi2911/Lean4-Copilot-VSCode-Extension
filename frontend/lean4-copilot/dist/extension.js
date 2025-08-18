"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/extension.ts
var extension_exports = {};
__export(extension_exports, {
  activate: () => activate,
  deactivate: () => deactivate
});
module.exports = __toCommonJS(extension_exports);
var vscode2 = __toESM(require("vscode"));

// src/api.ts
var BASE_URL = process.env.BACKEND_URL ?? "http://localhost:8000";
async function postJSON(path, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Backend error ${res.status}${text ? `: ${text}` : ""}`);
  }
  return await res.json();
}
async function suggestLine(fileText, cursorLine, cursorCol) {
  return await postJSON("/suggest", {
    file_text: fileText,
    cursor_line: cursorLine,
    cursor_col: cursorCol
  });
}
async function completeProof(fileText, instruction) {
  const res = await postJSON("/complete", {
    file_text: fileText,
    instruction
  });
  return res;
}

// src/ui/ErrorPanel.ts
var vscode = __toESM(require("vscode"));

// src/retry.ts
async function retryWithHint(fileText, userHint) {
  const res = await completeProof(fileText, userHint);
  return {
    ok: res.ok,
    proof: res.proof,
    log: res.log ?? "",
    attempt: res.attempt ?? null,
    // ⬅️ keep null if absent
    candidates: res.candidates
  };
}

// src/ui/ErrorPanel.ts
var ErrorPanel = class _ErrorPanel {
  static ctx;
  static panel = null;
  // NEW: remember which doc to retry against
  static targetUri = null;
  /** Call once from activate() */
  static init(ctx) {
    this.ctx = ctx;
  }
  static show(ctx, logText, targetUri, attemptText) {
    if (!this.ctx) this.ctx = ctx;
    this.targetUri = targetUri ?? vscode.window.activeTextEditor?.document.uri ?? this.targetUri ?? null;
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Beside);
      this.panel.webview.postMessage({
        command: "updateError",
        log: logText,
        attempt: attemptText ?? ""
      });
      return;
    }
    this.panel = vscode.window.createWebviewPanel(
      "lean4CopilotError",
      "Lean4 Copilot \u2014 Verification Log",
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      { enableScripts: true, retainContextWhenHidden: true }
    );
    this.panel.onDidDispose(
      () => _ErrorPanel.panel = null,
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
          const hint = typeof msg.hint === "string" ? msg.hint : void 0;
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
  static async handleRetry(userHint) {
    const uri = this.targetUri ?? vscode.window.activeTextEditor?.document.uri ?? null;
    if (!uri) {
      vscode.window.showWarningMessage(
        "Lean4 Copilot: No active editor to retry."
      );
      return;
    }
    const originalDoc = await vscode.workspace.openTextDocument(uri);
    const fileText = originalDoc.getText();
    const progressTitle = "Lean4 Copilot: Retrying\u2026";
    const result = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: progressTitle },
      async (_progress, _token) => {
        try {
          const res = await retryWithHint(fileText, userHint);
          return res;
        } catch (e) {
          return {
            ok: false,
            proof: fileText,
            log: e?.message ?? String(e),
            attempt: null
          };
        }
      }
    );
    if (!result.ok) {
      this.postToWebview({
        command: "updateError",
        log: result.log || "Verification failed.",
        attempt: result.attempt ?? ""
      });
      return;
    }
    this.dispose();
    await this.openDiffWithApplyDiscard(originalDoc, result.proof);
  }
  static async openDiffWithApplyDiscard(originalDoc, proposedText) {
    const tempDoc = await vscode.workspace.openTextDocument({
      content: proposedText,
      language: originalDoc.languageId || "lean4"
    });
    await vscode.window.showTextDocument(tempDoc, {
      preview: true,
      preserveFocus: true
    });
    const title = "Lean4 Copilot: Proposed changes";
    await vscode.commands.executeCommand(
      "vscode.diff",
      originalDoc.uri,
      tempDoc.uri,
      title,
      {
        preview: true
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
      vscode.window.setStatusBarMessage("Lean4 Copilot: Applied.", 2e3);
    } else {
      await this.closeActiveEditorIfDiff();
      await this.focusAndCloseDoc(tempDoc.uri);
      vscode.window.setStatusBarMessage("Lean4 Copilot: Discarded.", 2e3);
    }
  }
  static async applyFullDocumentEdit(doc, newText) {
    const fullRange = new vscode.Range(
      doc.positionAt(0),
      doc.positionAt(doc.getText().length)
    );
    const editor = await vscode.window.showTextDocument(doc, {
      preview: false
    });
    await editor.edit((eb) => eb.replace(fullRange, newText));
  }
  static async closeActiveEditorIfDiff() {
    await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
  }
  static async focusAndCloseDoc(uri) {
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
  static postToWebview(message) {
    if (this.panel) {
      this.panel.webview.postMessage(message);
    }
  }
  static getHtml(_webview, logText, attemptText) {
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
    const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    return `
  <!doctype html>
  <html>
    <head>
      <meta charset="utf-8"/>
      <title>Lean4 Copilot \u2014 Verification Log</title>
      <style>${css}</style>
    </head>
    <body>
      <h2>Lean4 Copilot \u2014 Verification Log</h2>

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
};

// src/extension.ts
var EXT_CTX;
var ProposedContentProvider = class {
  emitter = new vscode2.EventEmitter();
  onDidChange = this.emitter.event;
  store = /* @__PURE__ */ new Map();
  set(uri, text) {
    this.store.set(uri.toString(), text);
    this.emitter.fire(uri);
  }
  has(uri) {
    return this.store.has(uri.toString());
  }
  clear(uri) {
    this.store.delete(uri.toString());
    this.emitter.fire(uri);
  }
  provideTextDocumentContent(uri) {
    return this.store.get(uri.toString()) ?? "";
  }
};
var SCHEME = "lean4copilot";
var provider;
var proposals = /* @__PURE__ */ new Map();
var acceptBtn;
var discardBtn;
function activate(context) {
  EXT_CTX = context;
  ErrorPanel.init(context);
  provider = new ProposedContentProvider();
  context.subscriptions.push(
    vscode2.workspace.registerTextDocumentContentProvider(SCHEME, provider)
  );
  acceptBtn = vscode2.window.createStatusBarItem(
    vscode2.StatusBarAlignment.Right,
    100
  );
  acceptBtn.text = "$(check) Accept Copilot";
  acceptBtn.tooltip = "Apply the proposed Copilot changes";
  acceptBtn.command = "lean4Copilot.applyProposed";
  acceptBtn.hide();
  discardBtn = vscode2.window.createStatusBarItem(
    vscode2.StatusBarAlignment.Right,
    99
  );
  discardBtn.text = "$(close) Discard Copilot";
  discardBtn.tooltip = "Discard the proposed Copilot changes";
  discardBtn.command = "lean4Copilot.discardProposed";
  discardBtn.hide();
  context.subscriptions.push(acceptBtn, discardBtn);
  context.subscriptions.push(
    vscode2.commands.registerCommand(
      "lean4Copilot.applyProposed",
      applyCurrentProposal
    ),
    vscode2.commands.registerCommand(
      "lean4Copilot.discardProposed",
      discardCurrentProposal
    )
  );
  const inlineCmd = vscode2.commands.registerCommand(
    "lean4Copilot.inlineSuggest",
    async () => {
      const editor = vscode2.window.activeTextEditor;
      if (!editor || editor.document.uri.scheme === SCHEME) {
        vscode2.window.showInformationMessage(
          "Open a Lean file to use Ghost Suggest."
        );
        return;
      }
      await vscode2.commands.executeCommand(
        "editor.action.inlineSuggest.trigger"
      );
    }
  );
  context.subscriptions.push(inlineCmd);
  const inlineProvider = vscode2.languages.registerInlineCompletionItemProvider(
    { language: "lean4" },
    new GhostInlineProvider()
  );
  context.subscriptions.push(inlineProvider);
  const completeCmd = vscode2.commands.registerCommand(
    "lean4Copilot.completeProof",
    () => handleCompleteProof()
  );
  context.subscriptions.push(completeCmd);
  context.subscriptions.push(
    vscode2.window.onDidChangeActiveTextEditor(updateStatusButtons),
    vscode2.workspace.onDidCloseTextDocument(updateStatusButtons)
  );
}
function deactivate() {
}
var GhostInlineProvider = class {
  lastKey = null;
  lastSuggestion = null;
  async provideInlineCompletionItems(document, position) {
    try {
      if (document.uri.scheme === SCHEME) return null;
      const key = `${document.uri.toString()}@${document.version}:${position.line}:${position.character}`;
      if (this.lastKey === key && this.lastSuggestion)
        return listFor(position, this.lastSuggestion);
      const fileText = document.getText();
      const { suggestion } = await suggestLine(
        fileText,
        position.line,
        position.character
      );
      if (!suggestion) {
        this.lastKey = key;
        this.lastSuggestion = null;
        return null;
      }
      this.lastKey = key;
      this.lastSuggestion = suggestion;
      return listFor(position, suggestion);
    } catch {
      return null;
    }
  }
};
function listFor(pos, text) {
  const range = new vscode2.Range(pos, pos);
  return { items: [new vscode2.InlineCompletionItem(text, range)] };
}
async function handleCompleteProof() {
  const editor = vscode2.window.activeTextEditor;
  if (!editor) {
    vscode2.window.showWarningMessage("Lean4 Copilot: No active editor.");
    return;
  }
  const doc = editor.document;
  const originalText = doc.getText();
  try {
    const res = await vscode2.window.withProgress(
      {
        location: vscode2.ProgressLocation.Notification,
        title: "Lean4 Copilot: Completing proof\u2026"
      },
      () => completeProof(originalText)
    );
    if (!res.ok) {
      ErrorPanel.show(
        EXT_CTX,
        res.log ?? "Verification failed.",
        doc.uri,
        res.attempt ?? ""
      );
      return;
    }
    await showProposedDiff(doc, res.proof);
  } catch (e) {
    ErrorPanel.show(EXT_CTX, `Backend error: ${e?.message ?? String(e)}`);
  }
}
async function showProposedDiff(originalDoc, proposedText) {
  const base = originalDoc.uri.path.split("/").pop() || "Untitled.lean";
  const proposedUri = vscode2.Uri.parse(`${SCHEME}:${base}?t=${Date.now()}`);
  provider.set(proposedUri, proposedText);
  proposals.set(proposedUri.toString(), {
    original: originalDoc.uri,
    text: proposedText
  });
  await vscode2.commands.executeCommand(
    "vscode.diff",
    originalDoc.uri,
    proposedUri,
    "Lean4 Copilot: Proposed changes",
    {
      preview: true,
      viewColumn: vscode2.ViewColumn.Beside,
      preserveFocus: false
    }
  );
  updateStatusButtons();
}
async function applyCurrentProposal() {
  const active = vscode2.window.activeTextEditor?.document;
  if (!active || active.uri.scheme !== SCHEME) return;
  const rec = proposals.get(active.uri.toString());
  if (!rec) return;
  const targetDoc = await vscode2.workspace.openTextDocument(rec.original);
  const edit = new vscode2.WorkspaceEdit();
  const fullRange = new vscode2.Range(
    targetDoc.positionAt(0),
    targetDoc.positionAt(targetDoc.getText().length)
  );
  edit.replace(rec.original, fullRange, rec.text);
  await vscode2.workspace.applyEdit(edit);
  provider.clear(active.uri);
  proposals.delete(active.uri.toString());
  await vscode2.commands.executeCommand("workbench.action.closeActiveEditor");
  updateStatusButtons();
  vscode2.window.setStatusBarMessage("Lean4 Copilot: Applied.", 2e3);
}
async function discardCurrentProposal() {
  const proposedDoc = vscode2.window.activeTextEditor?.document;
  if (!proposedDoc || proposedDoc.uri.scheme !== SCHEME) return;
  provider.clear(proposedDoc.uri);
  proposals.delete(proposedDoc.uri.toString());
  await vscode2.commands.executeCommand("workbench.action.closeActiveEditor");
  updateStatusButtons();
  vscode2.window.setStatusBarMessage("Lean4 Copilot: Discarded.", 2e3);
}
function updateStatusButtons() {
  const isProposal = vscode2.window.activeTextEditor?.document.uri.scheme === SCHEME;
  if (isProposal) {
    acceptBtn.show();
    discardBtn.show();
  } else {
    acceptBtn.hide();
    discardBtn.hide();
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  activate,
  deactivate
});
//# sourceMappingURL=extension.js.map
