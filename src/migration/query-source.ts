import { Parser } from "acorn";
import jsx from "acorn-jsx";
/** Classification only. The archived canonical parser validates payload and placement. */
export function hasLegacyServerModule(source: string): boolean {
  try {
    const wrapped = "<>" + source + "</>";
    const ast = Parser.extend(jsx()).parse(wrapped, {
      ecmaVersion: "latest",
      sourceType: "module",
    }) as unknown as Record<string, unknown>;
    let found = false;
    const visit = (node: unknown): void => {
      if (!node || typeof node !== "object") return;
      const n = node as Record<string, any>;
      if (
        n.type === "JSXOpeningElement" &&
        n.name?.name === "script" &&
        n.attributes.some(
          (a: any) =>
            a.type === "JSXAttribute" &&
            a.name?.name === "type" &&
            a.value?.value === "server",
        )
      )
        found = true;
      for (const [key, value] of Object.entries(n)) {
        if (key === "start" || key === "end") continue;
        if (Array.isArray(value)) value.forEach(visit);
        else if (value && typeof value === "object") visit(value);
      }
    };
    visit(ast);
    return found;
  } catch {
    return false;
  }
}
