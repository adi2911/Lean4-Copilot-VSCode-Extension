// src/extension.ts
import * as vscode from "vscode";
import { completeProof, suggestLine } from "./api";
import { cleanSuggestion } from "./CleanSuggestion";
import { ErrorPanel } from "./ui/ErrorPanel"; // your existing panel

/* ──────────────────────────── Activation ──────────────────────────── */

export function activate(context: vscode.ExtensionContext) {
  // 1) Register inline ghost provider (Lean4)
  const inlineProvider = vscode.languages.registerInlineCompletionItemProvider(
    { language: "lean4" },
    new GhostInlineProvider()
  );

  // 2) Register "Complete Proof" command
  const completeCmd = vscode.commands.registerCommand(
    "lean4Copilot.completeProof",
    () => handleCompleteProof(context)
  );

  // (Optional) no-op command for discoverability in Command Palette
  const ghostCmd = vscode.commands.registerCommand(
    "lean4Copilot.inlineSuggest",
    () => {
      vscode.window.setStatusBarMessage(
        "Lean4 Copilot inline suggestions are active.",
        2000
      );
    }
  );

  context.subscriptions.push(inlineProvider, completeCmd, ghostCmd);

  // Track panel lifecycle
  ErrorPanel.init(context);
}

/* ─────────────────── Ghost Inline Suggestion Provider ─────────────────── */

class GhostInlineProvider implements vscode.InlineCompletionItemProvider {
  // Prevent spamming backend: cache last request by doc+pos+version
  private lastKey: string | null = null;
  private lastSuggestion: string | null = null;

  async provideInlineCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    _context: vscode.InlineCompletionContext,
    _token: vscode.CancellationToken
  ): Promise<vscode.InlineCompletionList | null> {
    try {
      const key = `${document.uri.toString()}@${document.version}:${
        position.line
      }:${position.character}`;

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
      // Stay silent on inline errors to avoid noisy UX
      return null;
    }
  }
}

function listFor(
  pos: vscode.Position,
  text: string
): vscode.InlineCompletionList {
  const range = new vscode.Range(pos, pos);
  const item = new vscode.InlineCompletionItem(text, range);
  return { items: [item] };
}

/* ─────────────────────── Complete Proof Command ─────────────────────── */

async function handleCompleteProof(context: vscode.ExtensionContext) {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage("No active editor.");
    return;
  }

  const doc = editor.document;
  const originalText = doc.getText();

  const progressTitle = "Lean4 Copilot: Completing proof…";
  const result = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: progressTitle },
    async () => {
      try {
        const res = await completeProof(originalText);

        if (!res.ok) {
          // Show error panel with verification log
          ErrorPanel.show(context, res.log ?? "Verification failed.");
          return { ok: false as const, proof: res.proof, log: res.log ?? "" };
        }

        return { ok: true as const, proof: res.proof, log: "" };
      } catch (e: any) {
        const msg = e?.message ?? String(e);
        ErrorPanel.show(context, `Backend error: ${msg}`);
        return { ok: false as const, proof: originalText, log: msg };
      }
    }
  );

  if (!result.ok) return;

  // Open a temp doc with the proposed full file and show a diff
  const tempDoc = await vscode.workspace.openTextDocument({
    content: result.proof,
    language: doc.languageId || "lean4",
  });

  await vscode.window.showTextDocument(tempDoc, {
    preview: true,
    preserveFocus: true,
  });

  const title = "Lean4 Copilot: Proposed changes";
  await vscode.commands.executeCommand(
    "vscode.diff",
    doc.uri,
    tempDoc.uri,
    title,
    { preview: true }
  );

  // Ask the user: Apply or Discard
  const action = await vscode.window.showInformationMessage(
    "Apply Lean4 Copilot changes?",
    { modal: true },
    "Apply",
    "Discard"
  );

  if (action === "Apply") {
    await applyFullDocumentEdit(doc, result.proof);
    await closeActiveEditorIfDiff(); // close the diff view
    // Also close the preview temp doc tab if still open
    await focusAndCloseDoc(tempDoc.uri);
    vscode.window.setStatusBarMessage("Lean4 Copilot: Applied.", 2000);
  } else {
    await closeActiveEditorIfDiff(); // close the diff view
    await focusAndCloseDoc(tempDoc.uri);
    vscode.window.setStatusBarMessage("Lean4 Copilot: Discarded.", 2000);
  }
}

/* ─────────────────────────── Helpers (editor) ─────────────────────────── */

async function applyFullDocumentEdit(
  doc: vscode.TextDocument,
  newText: string
) {
  const fullRange = new vscode.Range(
    doc.positionAt(0),
    doc.positionAt(doc.getText().length)
  );
  const editor = await vscode.window.showTextDocument(doc, { preview: false });
  await editor.edit((eb) => eb.replace(fullRange, newText));
}

async function closeActiveEditorIfDiff() {
  // The diff editor becomes active after we run vscode.diff
  await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
}

async function focusAndCloseDoc(uri: vscode.Uri) {
  // Focus the given doc (if it’s open) and close it
  const doc = vscode.workspace.textDocuments.find(
    (d) => d.uri.toString() === uri.toString()
  );
  if (!doc) return;
  const editor = vscode.window.visibleTextEditors.find(
    (e) => e.document === doc
  );
  if (editor) {
    await vscode.window.showTextDocument(editor.document, editor.viewColumn);
    await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
  }
}

/* ─────────────────────────── Deactivation ─────────────────────────── */

export function deactivate() {}
