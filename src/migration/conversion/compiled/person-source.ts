import { Parser } from "acorn";
import jsx from "acorn-jsx";
import { readSourceLiteral } from "./source-literal.ts";
import { MAX_COMPILED_SOURCE_BYTES } from "./contracts.ts";
import type { ReadLegacyPersonValueNames } from "./person-contracts.ts";
/** Select only exact current User display references. Admission separately validates
 * the complete component and server-proven inherited source-column declaration. */
export const readLegacyPersonValueNames: ReadLegacyPersonValueNames = (
  source,
) => {
  try {
    if (
      typeof source !== "string" ||
      Buffer.byteLength(source) > MAX_COMPILED_SOURCE_BYTES
    )
      return [];
    const text = "<> " + source + " </>",
      tree = Parser.extend(jsx()).parseExpressionAt(text, 0, {
        ecmaVersion: "latest",
      }) as any;
    if (tree.end !== text.length) return [];
    const names = new Set<string>();
    const walk = (node: any) => {
      if (!node || typeof node !== "object") return;
      if (
        node.type === "JSXElement" &&
        node.openingElement.name.name === "User"
      ) {
        const attrs = node.openingElement.attributes.filter(
          (a: any) => a.type === "JSXAttribute" && a.name?.name === "userId",
        );
        if (attrs.length === 1 && attrs[0].value) {
          try {
            const value = readSourceLiteral(attrs[0].value);
            if (
              typeof value === "string" &&
              /^\$[A-Za-z][A-Za-z0-9_]*$/.test(value) &&
              !["__proto__", "constructor", "prototype"].includes(
                value.slice(1),
              )
            )
              names.add(value.slice(1));
          } catch {}
        }
      }
      for (const value of Object.values(node)) {
        if (Array.isArray(value)) value.forEach(walk);
        else if (value && typeof value === "object") walk(value);
      }
    };
    walk(tree);
    return [...names].sort();
  } catch {
    return [];
  }
};
