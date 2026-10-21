import { createHash } from "node:crypto";
import { parse } from "parse5";

/** SHA-256 hex digest; credentials are only ever stored as this. */
export const hash = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

/** JSON safe to place inside an HTML <script> element. */
export const json = (value: unknown): string =>
  JSON.stringify(value).replaceAll("<", "\\u003c");

interface TitleNode {
  nodeName: string;
  tagName?: string;
  value?: string;
  childNodes?: TitleNode[];
}
/** Display text for a page; callers render it as text, never HTML. */
export function documentTitle(source: string): string {
  const tree = parse(source) as unknown as TitleNode;
  const find = (node: TitleNode, tag: string): TitleNode | undefined => {
    if (node.tagName === tag) return node;
    for (const child of node.childNodes || []) {
      const match = find(child, tag);
      if (match) return match;
    }
  };
  const text = (node: TitleNode): string => {
    if (["script", "style", "template"].includes(node.tagName || ""))
      return "";
    return node.nodeName === "#text"
      ? node.value || ""
      : (node.childNodes || []).map(text).join("");
  };
  const title = find(tree, "title");
  const heading = find(tree, "h1");
  return (
    (title && text(title).trim()) ||
    (heading && text(heading).trim()) ||
    "Untitled document"
  ).slice(0, 160);
}
