import * as assert from "assert";
import * as vscode from "vscode";
// import { showErrorPanel } from '../../ui/ErrorPanel' // adjust if needed

suite("ErrorPanel UI", () => {
  test("opens with a custom scheme doc (smoke)", async () => {
    const uri = vscode.Uri.parse("lean4copilot:proposal");
    const doc = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(doc);
    assert.strictEqual(editor.document.uri.scheme, "lean4copilot");
    // If you have showErrorPanel, call it here:
    // await showErrorPanel('Something went wrong')
  });
});
