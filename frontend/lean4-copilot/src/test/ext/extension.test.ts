import * as assert from "assert";
import * as vscode from "vscode";

suite("Extension Activation", () => {
  test("commands are registered", async () => {
    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes("lean4Copilot.completeProof"));
    assert.ok(commands.includes("lean4Copilot.inlineSuggest"));
    assert.ok(commands.includes("lean4Copilot.applyProposed"));
    assert.ok(commands.includes("lean4Copilot.discardProposed"));
  });
});
