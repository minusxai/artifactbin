/**
 * Source-preserving HTML editing on top of parse5 locations. Pure: every
 * helper reads a parsed document and returns splice edits against the
 * original string, so author bytes outside the edits are never touched.
 */
import { parse } from "parse5";
import type { DefaultTreeAdapterMap } from "parse5";

export type Element = DefaultTreeAdapterMap["element"];
type Node = DefaultTreeAdapterMap["node"];

export interface Edit {
  start: number;
  end: number;
  text: string;
}

export interface SourceDocument {
  source: string;
  html: Element | null;
  head: Element | null;
  body: Element | null;
  /** Every element in document order, template contents excluded. */
  elements: Element[];
  /** Elements inside template contents, in document order. */
  templateElements: Element[];
  /** End offset of the doctype in the source, or 0. */
  doctypeEnd: number;
}

const isElement = (node: Node): node is Element => "tagName" in node;

export function parseSource(source: string): SourceDocument {
  const document = parse(source, { sourceCodeLocationInfo: true });
  const elements: Element[] = [];
  const templateElements: Element[] = [];
  let html: Element | null = null;
  let head: Element | null = null;
  let body: Element | null = null;
  let doctypeEnd = 0;
  const visit = (node: Node, inTemplate: boolean): void => {
    if (isElement(node)) {
      (inTemplate ? templateElements : elements).push(node);
      if (!inTemplate) {
        if (node.tagName === "html" && !html) html = node;
        else if (node.tagName === "head" && !head) head = node;
        else if (node.tagName === "body" && !body) body = node;
      }
      if (node.tagName === "template" && "content" in node)
        for (const child of (node as DefaultTreeAdapterMap["template"]).content.childNodes)
          visit(child, true);
    } else if (node.nodeName === "#documentType") {
      doctypeEnd = node.sourceCodeLocation?.endOffset ?? 0;
    }
    if ("childNodes" in node) for (const child of node.childNodes) visit(child, inTemplate);
  };
  visit(document, false);
  return { source, html, head, body, elements, templateElements, doctypeEnd };
}

export function attribute(element: Element, name: string): string | null {
  for (const attr of element.attrs) if (attr.name === name && !attr.prefix) return attr.value;
  return null;
}

/** True when the element's start tag is written in the source (not implied by the parser). */
export function written(element: Element): boolean {
  return Boolean(element.sourceCodeLocation?.startTag);
}

/** Apply edits to the source. Edits at the same offset keep their list order. */
export function applyEdits(source: string, edits: readonly Edit[]): string {
  const ordered = edits
    .map((edit, index) => ({ edit, index }))
    .sort((a, b) => b.edit.start - a.edit.start || b.edit.end - a.edit.end || b.index - a.index);
  let output = source;
  for (const { edit } of ordered) output = output.slice(0, edit.start) + edit.text + output.slice(edit.end);
  return output;
}

function escapeAttribute(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;");
}

/** Where a new attribute goes: after the last written attribute, else after the tag name. */
function attributeInsertPoint(source: string, element: Element): number {
  const location = element.sourceCodeLocation!;
  let point = -1;
  for (const attr of Object.values(location.attrs ?? {})) point = Math.max(point, attr.endOffset);
  if (point >= 0) return point;
  let index = location.startTag!.startOffset + 1;
  while (index < source.length && !/[\s/>]/.test(source[index]!)) index++;
  return index;
}

export function insertAttribute(source: string, element: Element, name: string, value: string): Edit {
  const point = attributeInsertPoint(source, element);
  return { start: point, end: point, text: ` ${name}="${escapeAttribute(value)}"` };
}

/** Indentation before `offset` when only whitespace precedes it on its line. */
function lineIndent(source: string, offset: number): string | null {
  let start = offset;
  while (start > 0 && (source[start - 1] === " " || source[start - 1] === "\t")) start--;
  return start === 0 || source[start - 1] === "\n" ? source.slice(start, offset) : null;
}

/** Remove an element; when it sits alone on its line, the line goes with it. */
export function removeElement(source: string, element: Element): Edit {
  const location = element.sourceCodeLocation!;
  const start = location.startOffset;
  const end = location.endOffset;
  const indent = lineIndent(source, start);
  let after = end;
  while (after < source.length && (source[after] === " " || source[after] === "\t")) after++;
  const lineEnds = after === source.length || source[after] === "\n" || source[after] === "\r";
  if (indent !== null && lineEnds) {
    const lineStart = start - indent.length;
    if (lineStart > 0) {
      const newline = source[lineStart - 2] === "\r" ? lineStart - 2 : lineStart - 1;
      return { start: newline, end: after, text: "" };
    }
    let next = after;
    if (source[next] === "\r") next++;
    if (source[next] === "\n") next++;
    return { start: lineStart, end: next, text: "" };
  }
  return { start, end, text: "" };
}

/**
 * Markup placed first in <head>. `tags` are joined the way the head's next
 * line is indented; without a written <head> they go where the head would be.
 */
export function atHeadStart(document: SourceDocument, tags: readonly string[]): Edit {
  const { source, head, html } = document;
  if (head && written(head)) {
    const point = head.sourceCodeLocation!.startTag!.endOffset;
    const next = /^\r?\n([ \t]*)/.exec(source.slice(point));
    const text = next ? tags.map((tag) => `\n${next[1]}${tag}`).join("") : tags.join("");
    return { start: point, end: point, text };
  }
  const point = html && written(html) ? html.sourceCodeLocation!.startTag!.endOffset : document.doctypeEnd;
  return { start: point, end: point, text: tags.join("") };
}

