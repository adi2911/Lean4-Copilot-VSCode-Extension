import * as vscode from "vscode";
import {
  callLLMCompletion,
  completeProof,
  CompletionResponse,
  retryProof,
  validateWithLean,
} from "./api";
import { cleanSuggestion } from "./CleanSuggestion";
import { ErrorPanel } from "./ui/ErrorPanel";

/* ───────────────────────── Inline-ghost provider ────────────────────────── */
class LeanInlineProvider implements vscode.InlineCompletionItemProvider {
  async provideInlineCompletionItems(
    doc: vscode.TextDocument,
    pos: vscode.Position,
    _ctx: vscode.InlineCompletionContext,
    token: vscode.CancellationToken
  ): Promise<vscode.InlineCompletionList> {
    let res: CompletionResponse;
    try {
      res = await completeProof(doc.getText(), pos.line, pos.character);
    } catch (e: any) {
      console.error("[Lean4-Copilot] backend error:", e);
      return { items: [] };
    }
    if (token.isCancellationRequested) return { items: [] };

    /* 1. happy path → ghost text */
    if (res.ok) {
      const tail = extractTail(doc.getText(), res.code, doc.offsetAt(pos));
      return tail.trim()
        ? { items: [new vscode.InlineCompletionItem(tail)] }
        : { items: [] };
    }

    /* 2. compilation failed → error panel */
    const ed = vscode.window.activeTextEditor;
    if (ed) await handle(res, ed);
    return { items: [] };
  }
}

/* heuristic: keep only new suffix */
function extractTail(
  original: string,
  candidate: string,
  cursorIdx: number
): string {
  if (
    candidate.length > cursorIdx &&
    candidate.startsWith(original.slice(0, cursorIdx))
  ) {
    return candidate.slice(cursorIdx);
  }
  return "";
}

/* ───────────────────────── Activation ───────────────────────────────────── */
export function activate(ctx: vscode.ExtensionContext) {
  console.log("Lean4 Copilot activated ✅");

  /* register provider for Lean3+Lean4 */
  const selector: vscode.DocumentSelector = [
    { language: "lean4", scheme: "file" },
    { language: "lean", scheme: "file" },
  ];
  ctx.subscriptions.push(
    vscode.languages.registerInlineCompletionItemProvider(
      selector,
      new LeanInlineProvider()
    )
  );

  ctx.subscriptions.push(
    vscode.commands.registerCommand("lean4Copilot.completeProof", async () => {
      const ed = vscode.window.activeTextEditor;
      if (!ed) {
        vscode.window.showErrorMessage("No active editor");
        return;
      }
      await runCompletion(ed);
    })
  );

  const provider: vscode.InlineCompletionItemProvider = {
    async provideInlineCompletionItems(
      document,
      position,
      context,
      _token
    ): Promise<vscode.InlineCompletionList> {
      console.log(">>>>>>> vscode.InlineCompletionItemProvider");

      // Debounce at 300 ms
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

      // quick pre-check to avoid obvious junk
      if (!suggestion.trim()) return { items: [] };

      // validate before showing

      console.log(">>>> Moving to validating the response");
      const okResp = await validateWithLean(
        fileText.slice(0, document.offsetAt(position)) +
          suggestion +
          fileText.slice(document.offsetAt(position))
      );
      if (!okResp.ok) return { items: [] };

      console.log(`>>>>>> verification done ,Showing suggestion ${position}`);
      // VS Code shows it as greyed ghost text
      const item = new vscode.InlineCompletionItem(
        suggestion,
        new vscode.Range(position, position)
      );
      return { items: [item] };
    },
  };

  // register provider for Lean files
  ctx.subscriptions.push(
    vscode.languages.registerInlineCompletionItemProvider(
      { language: "lean4" },
      provider
    )
  );

  ctx.subscriptions.push(
    vscode.commands.registerCommand("lean4Copilot.inlineSuggest", async () => {
      // If user disabled inlineSuggest, tip them & bail out
      const inlineEnabled = vscode.workspace
        .getConfiguration("editor")
        .get<boolean>("inlineSuggest.enabled", false);

      if (!inlineEnabled) {
        vscode.window.showWarningMessage(
          "Enable Settings › Editor › Inline Suggest to see ghost completions."
        );
        return;
      }
      await vscode.commands.executeCommand(
        "editor.action.inlineSuggest.trigger"
      );
    })
  );
}
export function deactivate() {}

/* ───────────────────────── Diff-view completion (old path) ─────────────── */
async function runCompletion(editor: vscode.TextEditor) {
  const { document, selection } = editor;
  try {
    const res = await completeProof(
      document.getText(),
      selection.active.line,
      selection.active.character
    );
    await handle(res, editor);
  } catch (e: any) {
    vscode.window.showErrorMessage(`Completion failed: ${e.message ?? e}`);
  }
}

/* ───────────────────────── Shared error / diff logic ───────────────────── */
let errorPanel: ErrorPanel | undefined;
let diffDoc: vscode.TextDocument | undefined;

async function handle(res: CompletionResponse, editor: vscode.TextEditor) {
  /* success → diff-view */
  if (res.ok) {
    await showDiffAndApply(res.code, editor);
    closeErrorPanel();
    return;
  }

  /* failure → singleton ErrorPanel */
  if (!errorPanel) {
    errorPanel = ErrorPanel.create(res.log, retryWithHint);
    errorPanel.onDidDispose(() => (errorPanel = undefined));
  } else {
    errorPanel.update(res.log);
    errorPanel.reveal();
  }

  async function retryWithHint({ userHint }: { userHint: string | null }) {
    try {
      const newRes = await retryProof(
        res.code,
        res.log,
        userHint && userHint.trim() ? userHint : undefined
      );
      await handle(newRes, editor);
    } catch (e: any) {
      vscode.window.showErrorMessage(`Retry failed: ${e.message ?? e}`);
    }
  }
}

/* ───────────────────────── Diff helpers ────────────────────────────────── */
async function showDiffAndApply(fixed: string, editor: vscode.TextEditor) {
  if (fixed === editor.document.getText()) {
    vscode.window.showInformationMessage("Nothing to apply – proof already OK");
    return;
  }

  /* open / refresh diff doc */
  if (!diffDoc) {
    diffDoc = await vscode.workspace.openTextDocument({
      language: editor.document.languageId,
      content: fixed,
    });
  } else {
    await vscode.workspace.applyEdit(await replaceAll(diffDoc, fixed));
  }

  await vscode.commands.executeCommand(
    "vscode.diff",
    editor.document.uri,
    diffDoc.uri,
    "Lean Proof – Proposed Fix",
    { preview: false }
  );

  const choice = await vscode.window.showInformationMessage(
    "Apply the verified proof?",
    { modal: false },
    "Apply ✔︎",
    "Discard ✖︎"
  );

  if (choice === "Apply ✔︎") {
    await editor.edit((e) => e.replace(fullRange(editor.document), fixed));
    vscode.window.setStatusBarMessage("✅ Proof applied", 2500);
  }

  /* Close the diff tab in both cases */
  await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
  diffDoc = undefined; // reset handle
}

function closeErrorPanel() {
  if (errorPanel) errorPanel.dispose();
}
function fullRange(doc: vscode.TextDocument) {
  return new vscode.Range(
    doc.positionAt(0),
    doc.positionAt(doc.getText().length)
  );
}
async function replaceAll(doc: vscode.TextDocument, newText: string) {
  const edit = new vscode.WorkspaceEdit();
  edit.replace(doc.uri, fullRange(doc), newText);
  return edit;
}
