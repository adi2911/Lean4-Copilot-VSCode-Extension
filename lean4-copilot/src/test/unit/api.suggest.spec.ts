import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { suggestLine } from "../../api";

const ok = (json: any) =>
  Promise.resolve({ ok: true, json: () => Promise.resolve(json) } as any);

const fail = (status: number, text = "Boom") =>
  Promise.resolve({
    ok: false,
    status,
    text: () => Promise.resolve(text),
  } as any);

describe("api.suggest", () => {
  const origFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn() as any;
  });

  afterEach(() => {
    global.fetch = origFetch as any;
    vi.restoreAllMocks();
  });

  it("happy path", async () => {
    (global.fetch as any).mockResolvedValueOnce(
      ok({ suggestion: "rfl\n", error: null })
    );

    const out = await suggestLine("theorem t : True := by\n", 3, 7);

    // assert one call
    expect((global.fetch as any).mock.calls).toHaveLength(1);
    const [url, init] = (global.fetch as any).mock.calls[0];

    // accept absolute URL; just ensure it ends with /suggest
    expect(String(url)).toMatch(/\/suggest$/);

    // method + headers
    expect(init).toEqual(
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
      })
    );

    // body keys (cursor_line / cursor_col)
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({
      file_text: "theorem t : True := by\n",
      cursor_line: 3,
      cursor_col: 7,
    });

    // response mapping
    expect(out.suggestion).toBe("rfl\n");
  });

  it("backend error bubbles with status and text", async () => {
    (global.fetch as any).mockResolvedValueOnce(fail(500, "Oops"));
    await expect(suggestLine("x", 0, 0)).rejects.toThrow(
      /Backend error 500: Oops/
    );
  });

  it("empty suggestion handled", async () => {
    (global.fetch as any).mockResolvedValueOnce(
      ok({ suggestion: "", error: null })
    );
    const out = await suggestLine("t", 0, 0);
    expect(out.suggestion).toBe("");
  });

  it("backend error bubbles with status and text", async () => {
    (global.fetch as any).mockResolvedValueOnce(fail(500, "Oops"));
    await expect(suggestLine("x", 0, 0)).rejects.toThrow(
      /Backend error 500: Oops/
    );
  });

  it("empty suggestion handled", async () => {
    (global.fetch as any).mockResolvedValueOnce(
      ok({ suggestion: "", error: null })
    );
    const out = await suggestLine("t", 0, 0);
    expect(out.suggestion).toBe("");
  });
});
