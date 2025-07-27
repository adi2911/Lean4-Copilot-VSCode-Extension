const BASE_URL = process.env.BACKEND_URL ?? "http://localhost:8000";

async function postJSON<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`Backend error ${res.status}`);
  }
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

export async function callLLMCompletion(
  fileText: string,
  line: number,
  col: number,
  maxTokens = 128
): Promise<string> {
  console.log(">>>>> I was called", fileText);
  const payload = {
    file_text: fileText,
    cursor_line: line,
    cursor_col: col,
    max_tokens: maxTokens,
  };

  const res = await fetch(`${BASE_URL}/complete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  console.log(">>>> response received ", res.body);

  if (!res.ok || !res.body) {
    throw new Error("backend /complete failed");
  }

  // stream the response body into a string
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

/** Ask /validate whether Lean accepts the file */
export async function validateWithLean(
  fullFile: string
): Promise<LeanValidationResponse> {
  const res = await fetch(`${BASE_URL}/validate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file_text: fullFile }),
  });

  console.log(">>>> validation received", res.body);
  if (!res.ok) {
    throw new Error("backend /validate failed");
  }
  // cast unknown → LeanValidationResponse
  return (await res.json()) as LeanValidationResponse;
}

/** Handy interface if you want strong typing elsewhere */
export interface LeanValidationResponse {
  ok: boolean;
  log: string;
}

export interface CompletionResponse {
  ok: boolean; // proof verifies?
  code: string; // Lean snippet or full file
  log: string; // Lean error output (empty if ok==true)
}

export interface LeanValidationResponse {
  ok: boolean;
  log: string;
}
