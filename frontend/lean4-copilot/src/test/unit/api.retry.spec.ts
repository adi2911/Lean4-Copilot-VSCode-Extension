import { describe, expect, it, vi } from "vitest";
import * as api from "../../api";
import { retryWithHint } from "../../retry";

describe("retryWithHint", () => {
  it("with user prompt forwards to completeProof(fileText, hint)", async () => {
    const spy = vi
      .spyOn(api, "completeProof")
      .mockResolvedValue({ ok: true, proof: "QED", log: null } as any);
    const r = await retryWithHint("theorem", "try rfl");
    expect(spy).toHaveBeenCalledWith("theorem", "try rfl");
    expect(r).toEqual({
      ok: true,
      proof: "QED",
      log: "" /* if you normalize null to "" */,
    });
  });

  it("without user prompt passes undefined", async () => {
    const spy = vi
      .spyOn(api, "completeProof")
      .mockResolvedValue({ ok: true, proof: "OK", log: "L" } as any);
    const r = await retryWithHint("theorem");
    expect(spy).toHaveBeenCalledWith("theorem", undefined);
    expect(r).toEqual({ ok: true, proof: "OK", log: "L" });
  });

  it("propagates failure shape", async () => {
    vi.spyOn(api, "completeProof").mockResolvedValue({
      ok: false,
      proof: "",
      log: "bad",
    } as any);
    const r = await retryWithHint("theorem", "hint");
    expect(r).toEqual({ ok: false, proof: "", log: "bad" });
  });
});
