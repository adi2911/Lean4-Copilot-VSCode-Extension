import * as vscode from "vscode";
import { completeProof, CompletionResponse, retryProof } from "./api";
import { ErrorPanel } from "./ui/ErrorPanel";

/* ───────────────────────── Activation ─────────────────────────────────── */
export function activate(context: vscode.ExtensionContext) {
  const cmd = vscode.commands.registerCommand(
    "lean4Copilot.completeProof",
    async () => {
      const ed = vscode.window.activeTextEditor;
      if (!ed) {
        vscode.window.showErrorMessage("No active editor");
        return;
      }
      await runCompletion(ed);
    }
  );
  context.subscriptions.push(cmd);
}
export function deactivate() {}

/* ───────────────────────── Globals ─────────────────────────────────────── */
let errorPanel: ErrorPanel | undefined;
let diffDoc: vscode.TextDocument | undefined;

/* ───────────────────────── Main flow  ──────────────────────────────────── */
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

async function handle(res: CompletionResponse, editor: vscode.TextEditor) {
  /* success → diff view --------------------------------------------------- */
  if (res.ok) {
    await showDiffAndApply(res.code, editor);
    closeErrorPanel();
    return;
  }

  /* failure → singleton ErrorPanel --------------------------------------- */
  if (!errorPanel) {
    errorPanel = ErrorPanel.create(res.log, retryWithHint);
    errorPanel.onDidDispose(() => (errorPanel = undefined));
  } else {
    errorPanel.update(res.log);
    errorPanel.reveal();
  }

  /* nested helper --------------------------------------------------------- */
  async function retryWithHint({ userHint }: { userHint: string | null }) {
    try {
      const newRes = await retryProof(
        res.code, // latest failing file
        res.log,
        userHint && userHint.trim() ? userHint : undefined
      );
      await handle(newRes, editor);
    } catch (e: any) {
      vscode.window.showErrorMessage(`Retry failed: ${e.message ?? e}`);
    }
  }
}

/* ───────────────────────── Diff + Apply UX ─────────────────────────────── */
/* ---------------------------------------------------------------------- */
/*  Diff view with toolbar buttons                                        */
/* ---------------------------------------------------------------------- */
async function showDiffAndApply(
  fixedContent: string,
  editor: vscode.TextEditor
) {
  /* 0. If no change, short-circuit */
  if (fixedContent === editor.document.getText()) {
    vscode.window.showInformationMessage(
      "Lean proof already correct — nothing to apply."
    );
    return;
  }

  /* 1. Create / update RHS “proposed fix” doc (singleton) */
  if (diffDoc) {
    await vscode.workspace.applyEdit(await replaceAll(diffDoc, fixedContent));
  } else {
    diffDoc = await vscode.workspace.openTextDocument({
      language: editor.document.languageId,
      content: fixedContent,
    });
  }

  /* 2. Open diff and add custom toolbar buttons via context-key */
  await vscode.commands.executeCommand(
    "vscode.diff",
    editor.document.uri,
    diffDoc.uri,
    "Lean Proof – Proposed Fix",
    { preview: false }
  );

  /* 3. Show Apply / Discard buttons */
  const choice = await vscode.window.showInformationMessage(
    "Proof verified – apply the proposed fix?",
    { modal: false },
    "Apply ✔︎",
    "Discard ✖︎"
  );

  if (choice === "Apply ✔︎") {
    await editor.edit((e) =>
      e.replace(fullRange(editor.document), fixedContent)
    );
    vscode.window.setStatusBarMessage("✅ Proof applied", 2500);
  } else if (choice === "Discard ✖︎") {
    vscode.commands.executeCommand("workbench.action.closeActiveEditor");
  }
}

/* ───────────────────────── Utilities ───────────────────────────────────── */
function closeErrorPanel() {
  if (errorPanel) {
    errorPanel.dispose();
    errorPanel = undefined;
  }
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
