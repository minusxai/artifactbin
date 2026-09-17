/**
 * The `<Mermaid>` inspector's lens (the Number inspector's story-number.ts, for
 * the diagram: its static `code` source and `title`). Pure (client + server safe).
 */
import { resolveJsxNodeAtPath, updateJsxElementAtPath, setStaticJsxAttr } from './jsx-edit';
import { parseJsx } from '@/lib/jsx';
import { mermaidSourceError } from '@/lib/story-ui/mermaid-source';

/** What the diagram panel renders from: the `<Mermaid>` at `astPath`, or null if there is none. */
export interface MermaidEmbed {
  code: string;
  title: string | null;
}

export function readMermaidEmbed(source: string, astPath: string): MermaidEmbed | null {
  const parsed = parseJsx(source);
  if (!parsed.ok) return null;
  const node = resolveJsxNodeAtPath(parsed.nodes, astPath);
  if (!node || node.type !== 'element' || !node.isComponent || node.tag !== 'Mermaid') return null;
  const str = (name: string) => {
    const v = node.attributes.find((a) => a.name === name)?.value;
    return v?.static && typeof v.json === 'string' ? v.json : null;
  };
  return { code: str('code') ?? '', title: str('title') };
}

/** A PARTIAL edit: absent fields stay untouched; a null title removes the attribute. */
export interface MermaidEmbedEdit {
  code?: string;
  title?: string | null;
}

/**
 * Source the publish door would refuse (empty, oversized, carrying configuration
 * directives) is refused here too, leaving the document unchanged: the panel
 * names the problem, and the last good diagram keeps rendering.
 */
export function updateMermaidEmbedInJsx(source: string, astPath: string, edit: MermaidEmbedEdit): string {
  if (edit.code !== undefined && mermaidSourceError(edit.code)) return source;
  return updateJsxElementAtPath(source, astPath, 'Mermaid', (el) => {
    if (edit.code !== undefined) setStaticJsxAttr(el, 'code', edit.code);
    if (edit.title !== undefined) setStaticJsxAttr(el, 'title', edit.title?.trim() ? edit.title : undefined);
  });
}
