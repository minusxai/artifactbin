import { parse } from "acorn";
const sensitive =
  /<!--|<\/?script(?=[\t\n\f\r />])|[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\uFDD0-\uFDEF\uFFFE\uFFFF]/i;
const string = (value) =>
  JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replace(
      /[\u007F-\uFFFF]/g,
      (char) => "\\u" + char.charCodeAt(0).toString(16).padStart(4, "0"),
    );
/** HTML-safe emitted JavaScript. AST transforms preserve string values, not source spellings.
 * @param {string} code
 * @returns {string}
 */
export function encodeRuntime(code) {
  const tree = parse(code, { ecmaVersion: "latest", sourceType: "script" });
  const edits = [];
  function visit(node, tagged = false) {
    // Escaped directive spelling affects strict-mode semantics; preserve it.
    if (
      node.type === "ExpressionStatement" &&
      typeof node.directive === "string"
    )
      return;
    if (node.type === "Literal" && typeof node.value === "string")
      edits.push([node.start, node.end, string(node.value)]);
    if (
      node.type === "Literal" &&
      node.regex &&
      sensitive.test(code.slice(node.start, node.end))
    )
      edits.push([
        node.start,
        node.end,
        "(new RegExp(" +
          string(node.regex.pattern) +
          "," +
          string(node.regex.flags) +
          "))",
      ]);
    if (node.type === "TemplateElement" && !tagged) {
      if (node.value.cooked === null)
        throw new Error("Invalid runtime template");
      edits.push([
        node.start,
        node.end,
        string(node.value.cooked)
          .slice(1, -1)
          .replaceAll("`", "\\`")
          .replaceAll("${", "\\${"),
      ]);
    }
    for (const [key, value] of Object.entries(node)) {
      if (key === "start" || key === "end") continue;
      if (Array.isArray(value)) {
        for (const child of value) if (child?.type) visit(child, tagged);
      } else if (value && typeof value === "object" && value.type)
        visit(
          value,
          tagged ||
            (node.type === "TaggedTemplateExpression" && key === "quasi"),
        );
    }
  }
  visit(tree);
  for (const [start, end, value] of edits.sort((a, b) => b[0] - a[0]))
    code = code.slice(0, start) + value + code.slice(end);
  if (
    /<!--|<\/?script(?=[\t\n\f\r />])|[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\uFDD0-\uFDEF\uFFFE\uFFFF]/i.test(
      code,
    )
  )
    throw new Error("Runtime has unsupported raw HTML-sensitive syntax");
  parse(code, { ecmaVersion: "latest", sourceType: "script" });
  return code;
}
