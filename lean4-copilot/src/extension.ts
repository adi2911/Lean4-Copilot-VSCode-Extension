// extension.ts
import * as vscode from "vscode";
import { completeProof, suggestLine } from "./api";
import { ErrorPanel } from "./ui/ErrorPanel";

/* ───────────────────────────── Module-level context ───────────────────────────── */
let EXT_CTX: vscode.ExtensionContext; // <-- store context here

/* ───────────────────── Provider for read-only proposed content ───────────────────── */

class ProposedContentProvider implements vscode.TextDocumentContentProvider {
  private emitter = new vscode.EventEmitter<vscode.Uri>();
  onDidChange = this.emitter.event;
  private store = new Map<string, string>();
  set(uri: vscode.Uri, text: string) {
    this.store.set(uri.toString(), text);
    this.emitter.fire(uri);
  }
  has(uri: vscode.Uri) {
    return this.store.has(uri.toString());
  }
  clear(uri: vscode.Uri) {
    this.store.delete(uri.toString());
    this.emitter.fire(uri);
  }
  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.store.get(uri.toString()) ?? "";
  }
}

/* ───────────────────────────── Global proposal state ───────────────────────────── */

const SCHEME = "lean4copilot";
let provider: ProposedContentProvider;
const proposals = new Map<string, { original: vscode.Uri; text: string }>(); // key = proposedUri.toString()

let acceptBtn: vscode.StatusBarItem;
let discardBtn: vscode.StatusBarItem;

/* ─────────────────────────── Activation / Registration ─────────────────────────── */

export function activate(context: vscode.ExtensionContext) {
  // save context for later use
  EXT_CTX = context; // <-- remember it
  ErrorPanel.init(context); // <-- you already had this

  // Register our read-only content provider
  provider = new ProposedContentProvider();
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(SCHEME, provider)
  );

  // Status bar buttons
  acceptBtn = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100
  );
  acceptBtn.text = "$(check) Accept Copilot";
  acceptBtn.tooltip = "Apply the proposed Copilot changes";
  acceptBtn.command = "lean4Copilot.applyProposed";
  acceptBtn.hide();

  discardBtn = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    99
  );
  discardBtn.text = "$(close) Discard Copilot";
  discardBtn.tooltip = "Discard the proposed Copilot changes";
  discardBtn.command = "lean4Copilot.discardProposed";
  discardBtn.hide();

  context.subscriptions.push(acceptBtn, discardBtn);

  // Commands to apply/discard the currently visible proposed doc
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "lean4Copilot.applyProposed",
      applyCurrentProposal
    ),
    vscode.commands.registerCommand(
      "lean4Copilot.discardProposed",
      discardCurrentProposal
    )
  );

  // Inline ghost command (triggers VS Code's inline suggestions)
  const inlineCmd = vscode.commands.registerCommand(
    "lean4Copilot.inlineSuggest",
    async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.document.uri.scheme === SCHEME) {
        vscode.window.showInformationMessage(
          "Open a Lean file to use Ghost Suggest."
        );
        return;
      }
      await vscode.commands.executeCommand(
        "editor.action.inlineSuggest.trigger"
      );
    }
  );
  context.subscriptions.push(inlineCmd);

  // Inline ghost provider
  const inlineProvider = vscode.languages.registerInlineCompletionItemProvider(
    { language: "lean4" },
    new GhostInlineProvider()
  );
  context.subscriptions.push(inlineProvider);

  // Complete Proof command
  const completeCmd = vscode.commands.registerCommand(
    "lean4Copilot.completeProof",
    () => handleCompleteProof()
  );
  context.subscriptions.push(completeCmd);

  // Show/hide status buttons when editor changes
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(updateStatusButtons),
    vscode.workspace.onDidCloseTextDocument(updateStatusButtons)
  );
}

export function deactivate() {
  // noop
}

/* ───────────────────────── Ghost Inline Suggestion Provider ─────────────────────── */

class GhostInlineProvider implements vscode.InlineCompletionItemProvider {
  private lastKey: string | null = null;
  private lastSuggestion: string | null = null;

  async provideInlineCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position
  ): Promise<vscode.InlineCompletionList | null> {
    try {
      // avoid suggesting in our read-only scheme
      if (document.uri.scheme === SCHEME) return null;

      const key = `${document.uri.toString()}@${document.version}:${
        position.line
      }:${position.character}`;
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
}

function listFor(
  pos: vscode.Position,
  text: string
): vscode.InlineCompletionList {
  const range = new vscode.Range(pos, pos);
  return { items: [new vscode.InlineCompletionItem(text, range)] };
}

/* ───────────────────────────── /complete: new UX flow ───────────────────────────── */

async function handleCompleteProof() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage("Lean4 Copilot: No active editor.");
    return;
  }
  const doc = editor.document;
  const originalText = doc.getText();

  try {
    const res = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Lean4 Copilot: Completing proof…",
      },
      () => completeProof(originalText)
    );

    if (!res.ok) {
      // pass doc.uri so Retry knows what to re-run against
      ErrorPanel.show(
        EXT_CTX,
        res.log ?? "Verification failed.",
        doc.uri,
        res.attempt ?? ""
      );
      return;
    }

    await showProposedDiff(doc, res.proof);
  } catch (e: any) {
    // ▼▼ and here too ▼▼
    ErrorPanel.show(EXT_CTX, `Backend error: ${e?.message ?? String(e)}`);
  }
}

/* Show a side-by-side diff with a read-only proposed doc (no save prompts) */
async function showProposedDiff(
  originalDoc: vscode.TextDocument,
  proposedText: string
) {
  const base = originalDoc.uri.path.split("/").pop() || "Untitled.lean";
  const proposedUri = vscode.Uri.parse(`${SCHEME}:${base}?t=${Date.now()}`);

  provider.set(proposedUri, proposedText);
  proposals.set(proposedUri.toString(), {
    original: originalDoc.uri,
    text: proposedText,
  });

  await vscode.commands.executeCommand(
    "vscode.diff",
    originalDoc.uri,
    proposedUri,
    "Lean4 Copilot: Proposed changes",
    {
      preview: true,
      viewColumn: vscode.ViewColumn.Beside,
      preserveFocus: false,
    } as vscode.TextDocumentShowOptions
  );

  updateStatusButtons();
}

/* ────────────────────────────── Apply / Discard logic ───────────────────────────── */

async function applyCurrentProposal() {
  const active = vscode.window.activeTextEditor?.document;
  if (!active || active.uri.scheme !== SCHEME) return;

  const rec = proposals.get(active.uri.toString());
  if (!rec) return;

  const targetDoc = await vscode.workspace.openTextDocument(rec.original);
  const edit = new vscode.WorkspaceEdit();
  const fullRange = new vscode.Range(
    targetDoc.positionAt(0),
    targetDoc.positionAt(targetDoc.getText().length)
  );
  edit.replace(rec.original, fullRange, rec.text);
  await vscode.workspace.applyEdit(edit);

  provider.clear(active.uri);
  proposals.delete(active.uri.toString());
  await vscode.commands.executeCommand("workbench.action.closeActiveEditor");

  updateStatusButtons();
  vscode.window.setStatusBarMessage("Lean4 Copilot: Applied.", 2000);
}

async function discardCurrentProposal() {
  const proposedDoc = vscode.window.activeTextEditor?.document;
  if (!proposedDoc || proposedDoc.uri.scheme !== SCHEME) return;

  provider.clear(proposedDoc.uri);
  proposals.delete(proposedDoc.uri.toString());
  await vscode.commands.executeCommand("workbench.action.closeActiveEditor");

  updateStatusButtons();
  vscode.window.setStatusBarMessage("Lean4 Copilot: Discarded.", 2000);
}

/* Show Accept/Discard only when a lean4copilot doc is active */
function updateStatusButtons() {
  const isProposal =
    vscode.window.activeTextEditor?.document.uri.scheme === SCHEME;
  if (isProposal) {
    acceptBtn.show();
    discardBtn.show();
  } else {
    acceptBtn.hide();
    discardBtn.hide();
  }
}
