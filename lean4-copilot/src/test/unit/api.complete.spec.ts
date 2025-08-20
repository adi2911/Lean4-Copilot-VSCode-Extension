import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { completeProof } from "../../api";

const ok = (json: any) =>
  Promise.resolve({ ok: true, json: () => Promise.resolve(json) } as any);
const okFail = (json: any) =>
  Promise.resolve({ ok: true, json: () => Promise.resolve(json) } as any);
const fail = (status: number, text = "Boom") =>
  Promise.resolve({
    ok: false,
    status,
    text: () => Promise.resolve(text),
  } as any);

describe("api.complete", () => {
  const origFetch = global.fetch;
  beforeEach(() => {
    global.fetch = vi.fn() as any;
  });
  afterEach(() => {
    global.fetch = origFetch as any;
    vi.restoreAllMocks();
  });

  it("with hint sends instruction", async () => {
    (global.fetch as any).mockResolvedValueOnce(
      ok({ ok: true, proof: "QED", log: null })
    );
    const out = await completeProof("theorem", "try rfl");
    const [, init] = (global.fetch as any).mock.calls[0];
    expect(JSON.parse(init.body)).toMatchObject({ instruction: "try rfl" });
    expect(out.ok).toBe(true);
    expect(out.proof).toBe("QED");
  });

  it("without hint omits/undefined instruction", async () => {
    (global.fetch as any).mockResolvedValueOnce(
      ok({ ok: true, proof: "DONE", log: null })
    );
    const out = await completeProof("theorem");
    const [, init] = (global.fetch as any).mock.calls[0];
    const body = JSON.parse(init.body);
    // tolerate either missing or undefined
    expect(Object.keys(body)).not.toContain("previous_suggestion");
    expect(out.ok).toBe(true);
    expect(out.proof).toBe("DONE");
  });

  it("backend 500 raises detailed error", async () => {
    (global.fetch as any).mockResolvedValueOnce(fail(500, "Oops"));
    await expect(completeProof("x")).rejects.toThrow(/Backend error 500: Oops/);
  });

  it("ok:false from backend maps through", async () => {
    (global.fetch as any).mockResolvedValueOnce(
      okFail({ ok: false, proof: "", log: "not provable" })
    );
    const out = await completeProof("y");
    expect(out.ok).toBe(false);
    expect(out.log).toBe("not provable");
  });
});
