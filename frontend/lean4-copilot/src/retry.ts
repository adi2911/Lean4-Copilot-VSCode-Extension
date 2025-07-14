import { CompletionResponse, retryProof } from "./api";

export async function runRetry(
  fileText: string,
  errorLog: string,
  userHint?: string
): Promise<CompletionResponse> {
  return retryProof(fileText, errorLog, userHint);
}
