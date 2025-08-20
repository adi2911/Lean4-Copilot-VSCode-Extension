// src/retry.ts
import { completeProof, CompleteResult } from "./api";

export type RetryResult = {
  ok: boolean;
  proof: string; // full-file content returned by backend
  log: string; // verification/error log (empty if ok)
};

/**
 * Retry proof completion with an optional user hint.
 * For now we just call /complete again (we'll forward the hint once backend accepts it).
 */
export async function retryWithHint(
  fileText: string,
  userHint?: string
): Promise<CompleteResult> {
  const res = await completeProof(fileText, userHint);
  return {
    ok: res.ok,
    proof: res.proof,
    log: res.log ?? "",
    attempt: res.attempt ?? null, // ⬅️ keep null if absent
    candidates: res.candidates,
  };
}
