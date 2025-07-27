import * as vscode from "vscode";

export type RetryPayload = { userHint: string | null };

export class ErrorPanel {
  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly onRetry: (payload: RetryPayload) => void
  ) {
    /* message handler ----------------------------------------------------- */
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
  public static create(
    errorLog: string,
    onRetry: (payload: RetryPayload) => void
  ): ErrorPanel {
    const panel = vscode.window.createWebviewPanel(
      "leanErrorPanel",
      "Lean Proof Error",
      vscode.ViewColumn.Beside,
      { enableScripts: true }
    );
    const self = new ErrorPanel(panel, onRetry);
    panel.webview.html = self.buildHtml(errorLog);
    return self;
  }

  /** Replace the error trace and keep the same textbox contents */
  public update(errorLog: string): void {
    this.panel.webview.postMessage({ command: "updateLog", log: errorLog });
    // Also update initial HTML in case the web-view was cleared
    this.panel.webview.html = this.buildHtml(errorLog);
  }

  /** Bring the panel to the foreground */
  public reveal(): void {
    this.panel.reveal(vscode.ViewColumn.Beside);
  }

  /** Dispose programmatically */
  public dispose(): void {
    this.panel.dispose();
  }

  /** Let caller react to manual close */
  public onDidDispose(cb: () => void): void {
    this.panel.onDidDispose(cb);
  }

  private buildHtml(errorLog: string): string {
    const esc = (s: string) =>
      s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const escapedLog = esc(errorLog);

    return /* html */ `<!DOCTYPE html>
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
    <textarea id="hint" placeholder="e.g. ‘Induction step is wrong’"></textarea>

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
</html>`;
  }
}
