import { parseFragment } from 'parse5';

interface Node {
  tagName?: string;
  attrs?: Array<{ name: string; value: string }>;
  childNodes?: Node[];
  content?: { childNodes: Node[] };
  sourceCodeLocation?: { startTag?: { endOffset: number }; endTag?: { startOffset: number } };
}

/** Fill a compiled rail's text leaves from the same version's live slide render. */
export function syncRailPreview(html: string): string {
  if (!html.includes('mx-rail')) return html;
  const root = parseFragment(html, { sourceCodeLocationInfo: true }) as unknown as Node;
  const live = new Map<string, Node>();
  const rail: Array<{ node: Node; slide: number }> = [];
  const railRoots: Node[] = [];
  const docRoots: Node[] = [];
  const attribute = (node: Node, name: string) => node.attrs?.find((a) => a.name === name)?.value;
  const visit = (node: Node, inRail = false, inDoc = false, slide = -1): void => {
    const classes = attribute(node, 'class')?.split(/\s+/) ?? [];
    const nextRail = inRail || classes.includes('mx-rail');
    const nextDoc = inDoc || classes.includes('mx-doc');
    const path = attribute(node, 'data-mx-ast');
    if (attribute(node, 'data-mx-slide') !== undefined) {
      if (nextRail) { slide = railRoots.length; railRoots.push(node); }
      else if (nextDoc) docRoots.push(node);
    }
    if (path && nextDoc && !nextRail) live.set(path, node);
    if (path && nextRail) rail.push({ node, slide });
    for (const child of node.content?.childNodes ?? node.childNodes ?? []) visit(child, nextRail, nextDoc, slide);
  };
  visit(root);
  const edits: Array<{ start: number; end: number; value: string }> = [];
  for (const { node: preview, slide } of rail) {
    const path = attribute(preview, 'data-mx-ast') ?? '';
    const railBase = attribute(railRoots[slide] ?? {}, 'data-mx-ast') ?? '';
    const docBase = attribute(docRoots[slide] ?? {}, 'data-mx-ast') ?? '';
    const sourcePath = railBase && docBase && path.startsWith(railBase) ? docBase + path.slice(railBase.length) : path;
    const source = live.get(sourcePath);
    if (!source || source.tagName !== preview.tagName) continue;
    if (source.childNodes?.some((child) => child.tagName) || preview.childNodes?.some((child) => child.tagName)) continue;
    const from = preview.sourceCodeLocation, to = source.sourceCodeLocation;
    if (!from?.startTag || !from.endTag || !to?.startTag || !to.endTag) continue;
    edits.push({ start: from.startTag.endOffset, end: from.endTag.startOffset, value: html.slice(to.startTag.endOffset, to.endTag.startOffset) });
  }
  for (const edit of edits.sort((a, b) => b.start - a.start)) html = html.slice(0, edit.start) + edit.value + html.slice(edit.end);
  return html;
}
