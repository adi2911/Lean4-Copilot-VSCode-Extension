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
async function completeProof(fileText, userHint) {
  const body = { file_text: fileText };
  if (userHint && userHint.trim()) {
    body["instruction"] = userHint.trim();
  }
  return await postJSON("/complete", body);
}

// src/CleanSuggestion.ts
function cleanSuggestion(raw) {
  if (!raw) return "";
  let t = raw.trim();
  if (t.startsWith("```")) {
    t = t.split("\n").filter((ln) => !ln.trim().startsWith("```")).join("\n").trim();
  }
  const lines = t.split(/\r?\n/);
  for (const ln of lines) {
    const noComment = stripLineComment(ln).trim();
    if (!noComment) continue;
    const single = noComment.replace(/\s+/g, " ").trim();
    return single + "\n";
  }
  return "";
}
function stripLineComment(line) {
  const idx = line.indexOf("--");
  if (idx === -1) return line;
  const before = line.slice(0, idx);
  if (/^\s*$/.test(before)) return "";
  return before;
}

// src/ui/ErrorPanel.ts
var vscode = __toESM(require("vscode"));

// src/retry.ts
async function retryWithHint(fileText, userHint) {
  const res = await completeProof(fileText, userHint);
  return {
    ok: res.ok,
    proof: res.proof,
    log: res.log ?? ""
  };
}

// src/ui/ErrorPanel.ts
var ErrorPanel = class _ErrorPanel {
  static ctx;
  static panel = null;
  /** Call once from activate() */
  static init(ctx) {
    this.ctx = ctx;
  }
  /** Open or reveal the panel with the given log text */
  static show(ctx, logText) {
    if (!this.ctx) this.ctx = ctx;
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Beside);
      this.panel.webview.postMessage({ command: "updateLog", log: logText });
      return;
    }
    this.panel = vscode.window.createWebviewPanel(
      "lean4CopilotError",
      "Lean4 Copilot \u2014 Verification Log",
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      {
        enableScripts: true,
        retainContextWhenHidden: true
      }
    );
    this.panel.onDidDispose(
      () => _ErrorPanel.panel = null,
      null,
      this.ctx.subscriptions
    );
    this.panel.webview.html = this.getHtml(this.panel.webview, logText);
    this.panel.webview.onDidReceiveMessage(async (msg) => {
      switch (msg.command) {
        case "retry": {
          const hint = typeof msg.hint === "string" ? msg.hint : void 0;
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
  static async handleRetry(userHint) {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage(
        "Lean4 Copilot: No active editor to retry."
      );
      return;
    }
    const originalDoc = editor.document;
    const fileText = originalDoc.getText();
    const progressTitle = "Lean4 Copilot: Retrying\u2026";
    const result = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: progressTitle },
      async () => {
        try {
          const res = await retryWithHint(fileText, userHint);
          return res;
        } catch (e) {
          return { ok: false, proof: fileText, log: e?.message ?? String(e) };
        }
      }
    );
    if (!result.ok) {
      this.postToWebview({
        command: "updateLog",
        log: result.log || "Verification failed."
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
  static getHtml(webview, logText) {
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
        <title>Lean4 Copilot \u2014 Verification Log</title>
      </head>
      <body>
        <h2>Lean4 Copilot \u2014 Verification Log</h2>
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
};
function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// src/extension.ts
function activate(context) {
  const inlineProvider = vscode2.languages.registerInlineCompletionItemProvider(
    { language: "lean4" },
    new GhostInlineProvider()
  );
  const completeCmd = vscode2.commands.registerCommand(
    "lean4Copilot.completeProof",
    () => handleCompleteProof(context)
  );
  const ghostCmd = vscode2.commands.registerCommand(
    "lean4Copilot.inlineSuggest",
    () => {
      vscode2.window.setStatusBarMessage(
        "Lean4 Copilot inline suggestions are active.",
        2e3
      );
    }
  );
  context.subscriptions.push(inlineProvider, completeCmd, ghostCmd);
  ErrorPanel.init(context);
}
var GhostInlineProvider = class {
  // Prevent spamming backend: cache last request by doc+pos+version
  lastKey = null;
  lastSuggestion = null;
  async provideInlineCompletionItems(document, position, _context, _token) {
    try {
      const key = `${document.uri.toString()}@${document.version}:${position.line}:${position.character}`;
      if (this.lastKey === key && this.lastSuggestion) {
        return listFor(position, this.lastSuggestion);
      }
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
      const ghost = cleanSuggestion(suggestion);
      if (!ghost) {
        return null;
      }
      this.lastKey = key;
      this.lastSuggestion = suggestion;
      return listFor(position, ghost);
    } catch {
      return null;
    }
  }
};
function listFor(pos, text) {
  const range = new vscode2.Range(pos, pos);
  const item = new vscode2.InlineCompletionItem(text, range);
  return { items: [item] };
}
async function handleCompleteProof(context) {
  const editor = vscode2.window.activeTextEditor;
  if (!editor) {
    vscode2.window.showWarningMessage("No active editor.");
    return;
  }
  const doc = editor.document;
  const originalText = doc.getText();
  const progressTitle = "Lean4 Copilot: Completing proof\u2026";
  const result = await vscode2.window.withProgress(
    { location: vscode2.ProgressLocation.Notification, title: progressTitle },
    async () => {
      try {
        const res = await completeProof(originalText);
        if (!res.ok) {
          ErrorPanel.show(context, res.log ?? "Verification failed.");
          return { ok: false, proof: res.proof, log: res.log ?? "" };
        }
        return { ok: true, proof: res.proof, log: "" };
      } catch (e) {
        const msg = e?.message ?? String(e);
        ErrorPanel.show(context, `Backend error: ${msg}`);
        return { ok: false, proof: originalText, log: msg };
      }
    }
  );
  if (!result.ok) return;
  const tempDoc = await vscode2.workspace.openTextDocument({
    content: result.proof,
    language: doc.languageId || "lean4"
  });
  await vscode2.window.showTextDocument(tempDoc, {
    preview: true,
    preserveFocus: true
  });
  const title = "Lean4 Copilot: Proposed changes";
  await vscode2.commands.executeCommand(
    "vscode.diff",
    doc.uri,
    tempDoc.uri,
    title,
    { preview: true }
  );
  const action = await vscode2.window.showInformationMessage(
    "Apply Lean4 Copilot changes?",
    { modal: true },
    "Apply",
    "Discard"
  );
  if (action === "Apply") {
    await applyFullDocumentEdit(doc, result.proof);
    await closeActiveEditorIfDiff();
    await focusAndCloseDoc(tempDoc.uri);
    vscode2.window.setStatusBarMessage("Lean4 Copilot: Applied.", 2e3);
  } else {
    await closeActiveEditorIfDiff();
    await focusAndCloseDoc(tempDoc.uri);
    vscode2.window.setStatusBarMessage("Lean4 Copilot: Discarded.", 2e3);
  }
}
async function applyFullDocumentEdit(doc, newText) {
  const fullRange = new vscode2.Range(
    doc.positionAt(0),
    doc.positionAt(doc.getText().length)
  );
  const editor = await vscode2.window.showTextDocument(doc, { preview: false });
  await editor.edit((eb) => eb.replace(fullRange, newText));
}
async function closeActiveEditorIfDiff() {
  await vscode2.commands.executeCommand("workbench.action.closeActiveEditor");
}
async function focusAndCloseDoc(uri) {
  const doc = vscode2.workspace.textDocuments.find(
    (d) => d.uri.toString() === uri.toString()
  );
  if (!doc) return;
  const editor = vscode2.window.visibleTextEditors.find(
    (e) => e.document === doc
  );
  if (editor) {
    await vscode2.window.showTextDocument(editor.document, editor.viewColumn);
    await vscode2.commands.executeCommand("workbench.action.closeActiveEditor");
  }
}
function deactivate() {
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  activate,
  deactivate
});
//# sourceMappingURL=extension.js.map
