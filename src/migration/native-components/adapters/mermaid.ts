import type { NativeComponentRule } from "../component-map.ts";
import type { NativeLowerBlocker } from "../lower.ts";
import type {
  NativeJson,
  RetainedAttribute,
  RetainedJsxNode,
} from "../analyze-contracts.ts";

/** Targeted to the product's af-mermaid/registerMermaid contract. */
export const NATIVE_MERMAID_RULES: readonly NativeComponentRule[] =
  Object.freeze([
    {
      tag: "Mermaid",
      htmlTag: "af-mermaid",
      kind: "native",
      module: "mermaid",
      register: "registerMermaid",
      attributes: Object.freeze({
        code: "string",
        title: "string",
        "color-mode": ["light", "dark", "auto"],
      }),
      properties: Object.freeze([]),
    },
  ]);

const allowedPassthrough = (name: string): boolean =>
  name === "id" ||
  name === "class" ||
  name === "className" ||
  name === "style" ||
  name.startsWith("aria-") ||
  name.startsWith("data-");
const colorModes = new Set(["light", "dark", "auto"]);

function blocker(
  node: RetainedJsxNode,
  code: string,
  detail: string,
  attribute?: string,
): NativeLowerBlocker {
  return {
    code,
    sourceNode: node.graphKey,
    ...(node.type === "element" ? { tag: node.tag } : {}),
    ...(attribute ? { attribute } : {}),
    detail,
  };
}

function literalString(attribute: RetainedAttribute): string | undefined {
  return attribute.value.static && typeof attribute.value.json === "string"
    ? attribute.value.json
    : undefined;
}

/**
 * Normalize only the static Mermaid surface supported by af-mermaid.
 * The target reads a literal code child when no code prop is present, supports
 * title and color-mode, and leaves its own async renderer/error/disposal path
 * in charge. Unknown configuration is retained and blocked for explicit review.
 */
export function prepareNativeMermaid(source: RetainedJsxNode): {
  node: RetainedJsxNode;
  blockers: readonly NativeLowerBlocker[];
} {
  if (source.type !== "element" || source.tag !== "Mermaid") {
    return {
      node: source,
      blockers: [
        blocker(
          source,
          "mermaid-tag-unsupported",
          "Mermaid adapter requires the authored Mermaid component.",
        ),
      ],
    };
  }

  const blockers: NativeLowerBlocker[] = [];
  const seen = new Set<string>();
  const codeAttributes: RetainedAttribute[] = [];
  const modeAttributes: RetainedAttribute[] = [];
  let explicitCode: string | undefined;

  for (const attribute of source.attributes) {
    if (seen.has(attribute.name)) {
      blockers.push(
        blocker(
          source,
          "mermaid-duplicate-attribute",
          "Repeated Mermaid attributes are ambiguous.",
          attribute.name,
        ),
      );
      continue;
    }
    seen.add(attribute.name);

    if (attribute.name === "code") {
      codeAttributes.push(attribute);
      explicitCode = literalString(attribute);
      if (explicitCode === undefined) {
        blockers.push(
          blocker(
            source,
            "mermaid-dynamic-code",
            "Dynamic Mermaid code needs a source binding contract; it is not replaced with static text.",
            "code",
          ),
        );
      }
      continue;
    }
    if (attribute.name === "title") {
      if (literalString(attribute) === undefined) {
        blockers.push(
          blocker(
            source,
            "mermaid-dynamic-title",
            "Dynamic Mermaid titles need an admitted binding.",
            "title",
          ),
        );
      }
      continue;
    }
    if (attribute.name === "colorMode" || attribute.name === "color-mode") {
      modeAttributes.push(attribute);
      const value = literalString(attribute);
      if (value === undefined || !colorModes.has(value)) {
        blockers.push(
          blocker(
            source,
            "mermaid-color-mode-invalid",
            "Mermaid color mode must be the literal light, dark, or auto.",
            attribute.name,
          ),
        );
      }
      continue;
    }
    if (!allowedPassthrough(attribute.name)) {
      blockers.push(
        blocker(
          source,
          "mermaid-config-unsupported",
          "Authored Mermaid configuration has no verified af-mermaid equivalent and must be reviewed.",
          attribute.name,
        ),
      );
    }
  }

  if (modeAttributes.length > 1) {
    blockers.push(
      blocker(
        source,
        "mermaid-color-mode-ambiguous",
        "Use exactly one of colorMode or color-mode.",
        "color-mode",
      ),
    );
  }

  let childCode: string | undefined;
  if (source.children.length) {
    const parts: string[] = [];
    for (const child of source.children) {
      if (child.type === "text") {
        parts.push(child.value);
      } else if (
        child.type === "expression" &&
        child.value.static &&
        typeof child.value.json === "string"
      ) {
        parts.push(child.value.json);
      } else if (child.type === "expression") {
        blockers.push(
          blocker(
            child,
            "mermaid-dynamic-code",
            "Dynamic Mermaid child content needs a source binding contract; it is not evaluated or guessed.",
          ),
        );
      } else {
        blockers.push(
          blocker(
            child,
            "mermaid-child-element-unsupported",
            "Mermaid source children must be text; nested elements are not diagram source.",
          ),
        );
      }
    }
    if (parts.length === source.children.length) childCode = parts.join("");
  }

  if (blockers.length) return { node: source, blockers };

  const attributes = source.attributes.map((attribute) => {
    if (attribute.name !== "colorMode") return attribute;
    return { ...attribute, name: "color-mode" };
  });
  if (!codeAttributes.length && childCode !== undefined) {
    attributes.push({
      name: "code",
      start: source.children[0]!.start,
      end: source.children[source.children.length - 1]!.end,
      value: { static: true, json: childCode as NativeJson },
    });
  }

  // Keep original children and identities. af-mermaid consumes initial text
  // nodes after connection; the explicit code attribute has product precedence.
  return { node: { ...source, attributes }, blockers: [] };
}
