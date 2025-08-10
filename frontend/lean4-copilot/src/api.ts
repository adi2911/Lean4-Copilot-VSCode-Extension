// src/api.ts
const BASE_URL = process.env.BACKEND_URL ?? "http://localhost:8000";

/* ------------------------------ HTTP helper ------------------------------ */
async function postJSON<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Backend error ${res.status}${text ? `: ${text}` : ""}`);
  }
  return (await res.json()) as T;
}

/* ------------------------------- Types ----------------------------------- */
export type SuggestResponse = {
  suggestion?: string;
  error?: string;
};

export type CompleteResponse = {
  proof: string;
  ok: boolean;
  log?: string;
};

export type ValidateResponse = {
  ok: boolean;
  error?: string;
};

/** Legacy shapes kept temporarily so extension.ts compiles before we refactor it */
export interface CompletionResponse {
  ok: boolean; // proof verifies?
  code: string; // Lean snippet or full file
  log: string; // Lean error output (empty if ok==true)
}

export interface LeanValidationResponse {
  ok: boolean;
  log: string;
}

/* ------------------------------- APIs ------------------------------------ */

/** /suggest : single-line ghost suggestion */
export async function suggestLine(
  fileText: string,
  cursorLine: number,
  cursorCol: number
): Promise<SuggestResponse> {
  return await postJSON<SuggestResponse>("/suggest", {
    file_text: fileText,
    cursor_line: cursorLine,
    cursor_col: cursorCol,
  });
}

export async function completeProof(
  fileText: string,
  userHint?: string
): Promise<CompleteResponse> {
  const body: Record<string, unknown> = { file_text: fileText };
  if (userHint && userHint.trim()) {
    body["instruction"] = userHint.trim();
  }
  return await postJSON<CompleteResponse>("/complete", body);
}

/** /validate : run Lean type-checker */
export async function validateWithLean(
  fileText: string
): Promise<LeanValidationResponse> {
  const res = await postJSON<ValidateResponse>("/validate", {
    file_text: fileText,
  });
  return { ok: res.ok, log: res.error ?? "" };
}

/* -------------------------- Legacy wrappers ------------------------------ */
/** Kept to avoid breaking current extension.ts; will be removed after refactor. */

/** Old ghost call used by inline provider; returns string suggestion directly */
export async function callLLMCompletion(
  fileText: string,
  cursorLine: number,
  cursorCol: number,
  _maxTokens?: number
): Promise<string> {
  const { suggestion } = await suggestLine(fileText, cursorLine, cursorCol);
  return suggestion ?? "";
}

/** Old retry flow; we route it to /complete until frontend is updated */
export async function retryProof(
  fileText: string,
  _errorLog: string,
  userHint?: string
): Promise<CompletionResponse> {
  const res = await completeProof(fileText, userHint);
  return { ok: res.ok, code: res.proof, log: res.log ?? "" };
}
