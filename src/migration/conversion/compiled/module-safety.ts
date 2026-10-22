import { parse } from "acorn";
/** Fail closed on HTML tokenizer state changes; parsing JS alone does not make an inline module safe. */
export function safeInlineModule(source: unknown): source is string {
  if (
    typeof source !== "string" ||
    /<!--|<\/?script(?=[\t\n\f\r />])/i.test(source)
  )
    return false;
  try {
    parse(source, { ecmaVersion: "latest", sourceType: "module" });
    return true;
  } catch {
    return false;
  }
}
