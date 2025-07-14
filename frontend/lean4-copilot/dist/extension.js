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
async function postJSON(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`Backend error ${res.status}`);
  return res.json();
}
async function completeProof(fileText, cursorLine, cursorCol, maxTokens = 512) {
  return postJSON(`${BASE_URL}/complete`, {
    file_text: fileText,
    cursor_line: cursorLine,
    cursor_col: cursorCol,
    max_tokens: maxTokens
  });
}
async function retryProof(fileText, errorLog, userNote) {
  return postJSON(`${BASE_URL}/retry`, {
    file_text: fileText,
    error_log: errorLog,
    user_note: userNote ?? null
  });
}

// src/ui/ErrorPanel.ts
var vscode = __toESM(require("vscode"));
var ErrorPanel = class _ErrorPanel {
  constructor(panel, onRetry) {
    this.panel = panel;
    this.onRetry = onRetry;
    this.panel.webview.onDidReceiveMessage((msg) => {
      if (msg.command === "retry") {
        this.onRetry({ userHint: msg.userHint ?? null });
      } else if (msg.command === "close") {
        this.dispose();
      }
    });
  }
  /* ---------------------------------------------------------------------- *
   *  Public helpers                                                        *
   * ---------------------------------------------------------------------- */
  /** Create a new panel (singleton managed by caller) */
  static create(errorLog, onRetry) {
    const panel = vscode.window.createWebviewPanel(
      "leanErrorPanel",
      "Lean Proof Error",
      vscode.ViewColumn.Beside,
      { enableScripts: true }
    );
    const self = new _ErrorPanel(panel, onRetry);
    panel.webview.html = self.buildHtml(errorLog);
    return self;
  }
  /** Replace the error trace and keep the same textbox contents */
  update(errorLog) {
    this.panel.webview.postMessage({ command: "updateLog", log: errorLog });
    this.panel.webview.html = this.buildHtml(errorLog);
  }
  /** Bring the panel to the foreground */
  reveal() {
    this.panel.reveal(vscode.ViewColumn.Beside);
  }
  /** Dispose programmatically */
  dispose() {
    this.panel.dispose();
  }
  /** Let caller react to manual close */
  onDidDispose(cb) {
    this.panel.onDidDispose(cb);
  }
  /* ---------------------------------------------------------------------- *
   *  HTML                                                                  *
   * ---------------------------------------------------------------------- */
  buildHtml(errorLog) {
    const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const escapedLog = esc(errorLog);
    return (
      /* html */
      `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>
    body { font-family: var(--vscode-font-family); margin: 0; }
    .container { padding: 1rem; }
    pre {
      background: var(--vscode-editor-background);
      color: var(--vscode-editor-foreground);
      padding: 1rem;
      border-radius: 6px;
      overflow-x: auto;
      white-space: pre-wrap;
    }
    textarea {
      width: 100%; height: 5rem;
      margin-top: 0.5rem;
      border-radius: 4px;
      padding: 0.5rem;
      font-family: var(--vscode-editor-font-family);
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border);
    }
    .btn-group { margin-top: 1rem; display: flex; gap: 0.5rem; }
    button {
      padding: 0.4rem 1rem;
      border: none; border-radius: 4px;
      cursor: pointer;
      font-weight: 500;
    }
    .retry { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
    .close { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
  </style>
</head>
<body>
  <div class="container">
    <h3>Lean validation failed</h3>
    <pre id="lean-log">${escapedLog}</pre>

    <label for="hint">Optional hint for the AI:</label>
    <textarea id="hint" placeholder="e.g. \u2018I suspect the induction step is wrong\u2019"></textarea>

    <div class="btn-group">
      <button id="retry" class="retry">Retry</button>
      <button id="close" class="close">Close</button>
    </div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();

    document.getElementById('retry').addEventListener('click', () => {
      const hint = document.getElementById('hint').value.trim();
      vscode.postMessage({ command: 'retry', userHint: hint });
    });
    document.getElementById('close').addEventListener('click', () => {
      vscode.postMessage({ command: 'close' });
    });

    /* Handle updates from extension host */
    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg.command === 'updateLog') {
        document.getElementById('lean-log').textContent = msg.log;
      }
    });
  </script>
</body>
</html>`
    );
  }
};

// src/extension.ts
function activate(context) {
  const cmd = vscode2.commands.registerCommand(
    "lean4Copilot.completeProof",
    async () => {
      const ed = vscode2.window.activeTextEditor;
      if (!ed) {
        vscode2.window.showErrorMessage("No active editor");
        return;
      }
      await runCompletion(ed);
    }
  );
  context.subscriptions.push(cmd);
}
function deactivate() {
}
var errorPanel;
var diffDoc;
async function runCompletion(editor) {
  const { document, selection } = editor;
  try {
    const res = await completeProof(
      document.getText(),
      selection.active.line,
      selection.active.character
    );
    await handle(res, editor);
  } catch (e) {
    vscode2.window.showErrorMessage(`Completion failed: ${e.message ?? e}`);
  }
}
async function handle(res, editor) {
  if (res.ok) {
    await showDiffAndApply(res.code, editor);
    closeErrorPanel();
    return;
  }
  if (!errorPanel) {
    errorPanel = ErrorPanel.create(res.log, retryWithHint);
    errorPanel.onDidDispose(() => errorPanel = void 0);
  } else {
    errorPanel.update(res.log);
    errorPanel.reveal();
  }
  async function retryWithHint({ userHint }) {
    try {
      const newRes = await retryProof(
        res.code,
        // latest failing file
        res.log,
        userHint && userHint.trim() ? userHint : void 0
      );
      await handle(newRes, editor);
    } catch (e) {
      vscode2.window.showErrorMessage(`Retry failed: ${e.message ?? e}`);
    }
  }
}
async function showDiffAndApply(fixedContent, editor) {
  if (fixedContent === editor.document.getText()) {
    vscode2.window.showInformationMessage(
      "Lean proof already correct \u2014 nothing to apply."
    );
    return;
  }
  if (diffDoc) {
    await vscode2.workspace.applyEdit(await replaceAll(diffDoc, fixedContent));
  } else {
    diffDoc = await vscode2.workspace.openTextDocument({
      language: editor.document.languageId,
      content: fixedContent
    });
  }
  await vscode2.commands.executeCommand(
    "vscode.diff",
    editor.document.uri,
    diffDoc.uri,
    "Lean Proof \u2013 Proposed Fix",
    { preview: false }
  );
  const choice = await vscode2.window.showInformationMessage(
    "Proof verified \u2013 apply the proposed fix?",
    { modal: false },
    "Apply \u2714\uFE0E",
    "Discard \u2716\uFE0E"
  );
  if (choice === "Apply \u2714\uFE0E") {
    await editor.edit(
      (e) => e.replace(fullRange(editor.document), fixedContent)
    );
    vscode2.window.setStatusBarMessage("\u2705 Proof applied", 2500);
  } else if (choice === "Discard \u2716\uFE0E") {
    vscode2.commands.executeCommand("workbench.action.closeActiveEditor");
  }
}
function closeErrorPanel() {
  if (errorPanel) {
    errorPanel.dispose();
    errorPanel = void 0;
  }
}
function fullRange(doc) {
  return new vscode2.Range(
    doc.positionAt(0),
    doc.positionAt(doc.getText().length)
  );
}
async function replaceAll(doc, newText) {
  const edit = new vscode2.WorkspaceEdit();
  edit.replace(doc.uri, fullRange(doc), newText);
  return edit;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  activate,
  deactivate
});
//# sourceMappingURL=extension.js.map
