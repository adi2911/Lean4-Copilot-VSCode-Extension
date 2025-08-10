// src/CleanSuggestion.ts

/**
 * Normalize model output to a single Lean line suitable for inline ghost text:
 * - Strip markdown fences/backticks
 * - Remove leading `--` comment lines
 * - Take the FIRST non-empty, non-comment line
 * - Collapse internal whitespace
 * - Ensure a trailing newline
 */
export function cleanSuggestion(raw: string | undefined | null): string {
  if (!raw) return "";

  let t = raw.trim();

  // Strip markdown code fences if present
  if (t.startsWith("```")) {
    t = t
      .split("\n")
      .filter((ln) => !ln.trim().startsWith("```"))
      .join("\n")
      .trim();
  }

  // Split and pick first meaningful line (skip empty & comment-only)
  const lines = t.split(/\r?\n/);
  for (const ln of lines) {
    const noComment = stripLineComment(ln).trim();
    if (!noComment) continue;

    // Collapse excessive internal whitespace but keep single spaces
    const single = noComment.replace(/\s+/g, " ").trim();

    // Guard against accidental multi-line constructs introduced by semicolons, etc.
    // (We still allow Lean tokens; just not literal newlines.)
    return single + "\n";
  }

  return "";
}

/**
 * Remove a single-line Lean comment prefix if the whole line is a comment.
 * If the comment occurs mid-line (code -- comment), keep the code part.
 */
function stripLineComment(line: string): string {
  // Lean single-line comments use `--`. We cut them if not inside a string (simple heuristic).
  const idx = line.indexOf("--");
  if (idx === -1) return line;

  // If everything before `--` is whitespace, consider it a pure comment line -> empty.
  const before = line.slice(0, idx);
  if (/^\s*$/.test(before)) return "";

  // Keep code before the comment
  return before;
}
