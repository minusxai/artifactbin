import type { ArchivedPresentationNode } from "./presentation-host-contracts.ts";
import type { PresentationIdentityHost } from "./presentation-kit-contracts.ts";
/** Migration-only structural transform, applied identically to SSR and browser generation. */
export function preservePresentationHosts(
  nodes: readonly ArchivedPresentationNode[],
  plan: readonly PresentationIdentityHost[],
): ArchivedPresentationNode[] {
  if (plan.length > 10000) throw Error("Presentation identity plan limit");
  const pending = new Map<string, PresentationIdentityHost>();
  for (const entry of plan) {
    if (
      !["Tooltip", "TooltipProvider"].includes(entry.tag) ||
      typeof entry.id !== "string" ||
      !entry.id ||
      entry.id.length > 256
    )
      throw Error("Invalid presentation identity host");
    const key = entry.tag + "\0" + entry.id;
    if (pending.has(key)) throw Error("Duplicate presentation identity host");
    pending.set(key, entry);
  }
  const found = new Set<string>();
  const visit = (node: ArchivedPresentationNode): ArchivedPresentationNode => {
    if (node.type !== "element") return node;
    const next = { ...node, children: (node.children ?? []).map(visit) };
    const ids = (node.attributes ?? []).filter((a) => a.name === "id");
    if (
      ids.length !== 1 ||
      !ids[0]!.value.static ||
      typeof ids[0]!.value.json !== "string"
    )
      return next;
    const key = node.tag + "\0" + ids[0]!.value.json;
    if (!pending.has(key)) return next;
    if (found.has(key)) throw Error("Duplicate presentation source identity");
    found.add(key);
    const inner = {
      ...next,
      attributes: (node.attributes ?? []).filter((a) => a.name !== "id"),
    };
    return {
      type: "element",
      tag: "span",
      isComponent: false,
      attributes: [
        ids[0]!,
        {
          name: "style",
          value: { static: true, json: { display: "contents" } },
          start: node.start,
          end: node.start,
        },
      ],
      children: [inner],
      selfClosing: false,
      start: node.start,
      end: node.end,
    };
  };
  const output = nodes.map(visit);
  if (found.size !== pending.size)
    throw Error("Presentation identity source mismatch");
  return output;
}
