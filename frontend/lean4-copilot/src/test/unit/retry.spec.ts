import { describe, expect, it, vi } from "vitest";
import * as api from "../../api";
import { retryWithHint } from "../../retry";

describe("retryWithHint", () => {
  it("forwards to completeProof and maps fields", async () => {
    const spy = vi.spyOn(api, "completeProof").mockResolvedValue({
      ok: true,
      proof: "QED",
      log: "LOG",
    } as any);
    const r = await retryWithHint("theorem", "hint");
    expect(spy).toHaveBeenCalledWith("theorem", "hint");
    expect(r).toEqual({ ok: true, proof: "QED", log: "LOG" });
  });
});
