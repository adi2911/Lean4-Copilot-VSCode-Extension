export interface CompletionResponse {
  ok: boolean; // proof verifies?
  code: string; // Lean snippet or full file
  log: string; // Lean error output (empty if ok==true)
}

const BASE_URL = process.env.BACKEND_URL ?? "http://localhost:8000";

async function postJSON<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Backend error ${res.status}`);
  return res.json() as Promise<T>;
}

export async function completeProof(
  fileText: string,
  cursorLine: number,
  cursorCol: number,
  maxTokens = 512
): Promise<CompletionResponse> {
  return postJSON<CompletionResponse>(`${BASE_URL}/complete`, {
    file_text: fileText,
    cursor_line: cursorLine,
    cursor_col: cursorCol,
    max_tokens: maxTokens,
  });
}

export async function retryProof(
  fileText: string,
  errorLog: string,
  userNote?: string
): Promise<CompletionResponse> {
  return postJSON<CompletionResponse>(`${BASE_URL}/retry`, {
    file_text: fileText,
    error_log: errorLog,
    user_note: userNote ?? null,
  });
}
