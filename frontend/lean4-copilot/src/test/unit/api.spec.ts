import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../api";

// helpers
const ok = (json: any) =>
  Promise.resolve({ ok: true, json: () => Promise.resolve(json) } as any);
const fail = (status: number, text = "Boom") =>
  Promise.resolve({
    ok: false,
    status,
    text: () => Promise.resolve(text),
  } as any);

describe("api.ts", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn() as any;
  });
  afterEach(() => {
    global.fetch = originalFetch as any;
    vi.restoreAllMocks();
  });

  it("suggestLine posts to /suggest and returns suggestion", async () => {
    (global.fetch as any).mockResolvedValueOnce(
      ok({ suggestion: "rfl\n", error: null })
    );
    const out = await api.suggestLine("theorem t : True := by\n", 0, 0);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringMatching(/\/suggest$/),
      expect.objectContaining({ method: "POST" })
    );
    expect(out.suggestion).toBe("rfl\n");
  });

  it("completeProof posts to /complete and maps response", async () => {
    (global.fetch as any).mockResolvedValueOnce(
      ok({ ok: true, proof: "…rfl\n", log: null })
    );
    const out = await api.completeProof("theorem t : True := by\n", "hint");
    expect(out.ok).toBe(true);
    expect(out.proof).toContain("rfl");
  });

  it("retryProof forwards to /complete and maps to legacy shape", async () => {
    (global.fetch as any).mockResolvedValueOnce(
      ok({ ok: true, proof: "done", log: "L" })
    );
    const r = await api.retryProof("text", "ignored", "hint");
    expect(r).toEqual({ ok: true, code: "done", log: "L" });
  });

  it("postJSON throws detailed error on non-200", async () => {
    (global.fetch as any).mockResolvedValueOnce(fail(500, "Oops"));
    await expect(api.completeProof("x")).rejects.toThrow(
      /Backend error 500: Oops/
    );
  });
});
