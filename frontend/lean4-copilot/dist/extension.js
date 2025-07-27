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
  if (!res.ok) {
    throw new Error(`Backend error ${res.status}`);
  }
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
async function callLLMCompletion(fileText, line, col, maxTokens = 128) {
  console.log(">>>>> I was called", fileText);
  const payload = {
    file_text: fileText,
    cursor_line: line,
    cursor_col: col,
    max_tokens: maxTokens
  };
  const res = await fetch(`${BASE_URL}/complete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  console.log(">>>> response received ", res.body);
  if (!res.ok || !res.body) {
    throw new Error("backend /complete failed");
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let out = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }
    out += decoder.decode(value);
    if (out.includes("[[END]]")) {
      break;
    }
  }
  return out.replace("[[END]]", "");
}
async function validateWithLean(fullFile) {
  const res = await fetch(`${BASE_URL}/validate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file_text: fullFile })
  });
  console.log(">>>> validation received", res.body);
  if (!res.ok) {
    throw new Error("backend /validate failed");
  }
  return await res.json();
}

// src/CleanSuggestion.ts
function cleanSuggestion(raw) {
  raw = raw.replace(/^```.*?\n?/s, "");
  raw = raw.replace(/\n?```$/s, "");
  return raw;
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
      padding: 1rem; border-radius: 6px;
      overflow-x: auto; white-space: pre-wrap;
    }
    textarea {
      width: 100%; height: 5rem; margin-top: .5rem;
      border-radius: 4px; padding: .5rem;
      font-family: var(--vscode-editor-font-family);
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border);
    }
    .btn-group { margin-top: 1rem; display: flex; gap: .5rem; }
    button {
      padding: .4rem 1rem; border: none; border-radius: 4px;
      cursor: pointer; font-weight: 500;
    }
    .retry { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
    .close { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
  </style>
</head>
<body>
  <div class="container">
    <h3>Lean verification failed</h3>
    <p>The generated code does not compile.  
       Add an optional hint below or press <b>Retry</b> to try again.</p>

    <pre id="lean-log">${escapedLog}</pre>

    <label for="hint">Hint for the AI (optional):</label>
    <textarea id="hint" placeholder="e.g. \u2018Induction step is wrong\u2019"></textarea>

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
    /* live updates */
    window.addEventListener('message', (event) => {
      if (event.data.command === 'updateLog') {
        document.getElementById('lean-log').textContent = event.data.log;
      }
    });
  </script>
</body>
</html>`
    );
  }
};

// src/extension.ts
var LeanInlineProvider = class {
  async provideInlineCompletionItems(doc, pos, _ctx, token) {
    let res;
    try {
      res = await completeProof(doc.getText(), pos.line, pos.character);
    } catch (e) {
      console.error("[Lean4-Copilot] backend error:", e);
      return { items: [] };
    }
    if (token.isCancellationRequested) return { items: [] };
    if (res.ok) {
      const tail = extractTail(doc.getText(), res.code, doc.offsetAt(pos));
      return tail.trim() ? { items: [new vscode2.InlineCompletionItem(tail)] } : { items: [] };
    }
    const ed = vscode2.window.activeTextEditor;
    if (ed) await handle(res, ed);
    return { items: [] };
  }
};
function extractTail(original, candidate, cursorIdx) {
  if (candidate.length > cursorIdx && candidate.startsWith(original.slice(0, cursorIdx))) {
    return candidate.slice(cursorIdx);
  }
  return "";
}
function activate(ctx) {
  console.log("Lean4 Copilot activated \u2705");
  const selector = [
    { language: "lean4", scheme: "file" },
    { language: "lean", scheme: "file" }
  ];
  ctx.subscriptions.push(
    vscode2.languages.registerInlineCompletionItemProvider(
      selector,
      new LeanInlineProvider()
    )
  );
  ctx.subscriptions.push(
    vscode2.commands.registerCommand("lean4Copilot.completeProof", async () => {
      const ed = vscode2.window.activeTextEditor;
      if (!ed) {
        vscode2.window.showErrorMessage("No active editor");
        return;
      }
      await runCompletion(ed);
    })
  );
  const provider = {
    async provideInlineCompletionItems(document, position, context, _token) {
      console.log(">>>>>>> vscode.InlineCompletionItemProvider");
      await new Promise((r) => setTimeout(r, 300));
      const fileText = document.getText();
      const suggestionRaw = await callLLMCompletion(
        fileText,
        position.line + 1,
        position.character + 1,
        128
      );
      console.log(">>>> received the suggestion moving to cleaning process");
      let suggestion = cleanSuggestion(suggestionRaw);
      console.log(">>>> clean suggestion : ", suggestion);
      if (!suggestion.startsWith("\n")) {
        suggestion = "\n  " + suggestion.trimStart();
      }
      if (!suggestion.trim()) return { items: [] };
      console.log(">>>> Moving to validating the response");
      const okResp = await validateWithLean(
        fileText.slice(0, document.offsetAt(position)) + suggestion + fileText.slice(document.offsetAt(position))
      );
      if (!okResp.ok) return { items: [] };
      console.log(`>>>>>> verification done ,Showing suggestion ${position}`);
      const item = new vscode2.InlineCompletionItem(
        suggestion,
        new vscode2.Range(position, position)
      );
      return { items: [item] };
    }
  };
  ctx.subscriptions.push(
    vscode2.languages.registerInlineCompletionItemProvider(
      { language: "lean4" },
      provider
    )
  );
  ctx.subscriptions.push(
    vscode2.commands.registerCommand("lean4Copilot.inlineSuggest", async () => {
      const inlineEnabled = vscode2.workspace.getConfiguration("editor").get("inlineSuggest.enabled", false);
      if (!inlineEnabled) {
        vscode2.window.showWarningMessage(
          "Enable Settings \u203A Editor \u203A Inline Suggest to see ghost completions."
        );
        return;
      }
      await vscode2.commands.executeCommand(
        "editor.action.inlineSuggest.trigger"
      );
    })
  );
}
function deactivate() {
}
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
var errorPanel;
var diffDoc;
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
        res.log,
        userHint && userHint.trim() ? userHint : void 0
      );
      await handle(newRes, editor);
    } catch (e) {
      vscode2.window.showErrorMessage(`Retry failed: ${e.message ?? e}`);
    }
  }
}
async function showDiffAndApply(fixed, editor) {
  if (fixed === editor.document.getText()) {
    vscode2.window.showInformationMessage("Nothing to apply \u2013 proof already OK");
    return;
  }
  if (!diffDoc) {
    diffDoc = await vscode2.workspace.openTextDocument({
      language: editor.document.languageId,
      content: fixed
    });
  } else {
    await vscode2.workspace.applyEdit(await replaceAll(diffDoc, fixed));
  }
  await vscode2.commands.executeCommand(
    "vscode.diff",
    editor.document.uri,
    diffDoc.uri,
    "Lean Proof \u2013 Proposed Fix",
    { preview: false }
  );
  const choice = await vscode2.window.showInformationMessage(
    "Apply the verified proof?",
    { modal: false },
    "Apply \u2714\uFE0E",
    "Discard \u2716\uFE0E"
  );
  if (choice === "Apply \u2714\uFE0E") {
    await editor.edit((e) => e.replace(fullRange(editor.document), fixed));
    vscode2.window.setStatusBarMessage("\u2705 Proof applied", 2500);
  }
  await vscode2.commands.executeCommand("workbench.action.closeActiveEditor");
  diffDoc = void 0;
}
function closeErrorPanel() {
  if (errorPanel) errorPanel.dispose();
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
