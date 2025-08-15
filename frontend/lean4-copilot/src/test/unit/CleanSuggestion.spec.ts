import { describe, expect, it } from "vitest";
import { cleanSuggestion } from "../../CleanSuggestion";

describe("cleanSuggestion", () => {
  it("returns empty for falsy input", () => {
    expect(cleanSuggestion(undefined)).toBe("");
    expect(cleanSuggestion(null)).toBe("");
    expect(cleanSuggestion("")).toBe("");
  });

  it("drops single-line comment only", () => {
    expect(cleanSuggestion("-- just a comment")).toBe("");
  });

  it("strips fences and takes first line", () => {
    const raw = "```lean\nrfl\nsimp\n```";
    expect(cleanSuggestion(raw)).toBe("rfl\n");
  });

  it("skips blank/comment lines and picks first useful line", () => {
    const raw = "\n-- meta\n   \nexact trivial\nsimp\n";
    expect(cleanSuggestion(raw)).toBe("exact trivial\n");
  });

  it("leaves trailing newline on valid output", () => {
    expect(cleanSuggestion("rfl")).toBe("rfl\n");
  });
});
