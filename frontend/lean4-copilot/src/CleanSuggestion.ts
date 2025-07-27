export function cleanSuggestion(raw: string): string {
  // remove ```lang ...``` opening fence
  raw = raw.replace(/^```.*?\n?/s, "");
  // remove closing fence
  raw = raw.replace(/\n?```$/s, "");
  return raw; // keep leading \n so "by\n  ..." stays on new line
}
