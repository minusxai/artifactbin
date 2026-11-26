/**
 * The module's document: Tiptap-shaped JSON (`{type:'doc',content:[...]}`), what `parse` returns, what `renderHtml`
 * writes and what the editor entry's schema holds node for node. Type-only, so the display entry stays free of
 * ProseMirror and Tiptap.
 *
 * Nodes: doc, paragraph, heading {level}, blockquote, bulletList {tight}, orderedList {start, tight}, listItem,
 * taskList {tight}, taskItem {checked}, codeBlock {language}, horizontalRule, table, tableRow, tableHeader {align},
 * tableCell {align}, text, hardBreak, image {src, alt, title}. Marks, outermost first: link {href, title}, bold,
 * italic, strike, code. Table cells and headings hold inline content only, and headings hold no hard break.
 */
export type MarkName = 'link' | 'bold' | 'italic' | 'strike' | 'code';
export interface MarkdownMark {
  type: MarkName;
  attrs?: { href: string; title: string | null };
}
export interface MarkdownNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: MarkdownNode[];
  text?: string;
  marks?: MarkdownMark[];
}
export interface MarkdownDoc extends MarkdownNode {
  type: 'doc';
  content: MarkdownNode[];
}
/** The marks' nesting order, outermost first: the editor schema's mark order (pinned by the editor tests). */
export const MARK_ORDER: readonly MarkName[] = ['link', 'bold', 'italic', 'strike', 'code'];

/** Something the source asked for and the module showed as typed instead. */
export interface Refusal {
  kind: 'link' | 'image';
  /** The source exactly as typed, which is what the document shows. */
  source: string;
  /** The address the source named, normalized as a link would carry it. */
  href: string;
}
export interface ParseOptions {
  /** A single newline is a line break (the default); `false` joins the lines with a space. */
  breaks?: boolean;
  /** The image element, a per-surface switch (off by default): when off, image syntax shows as typed. */
  images?: boolean;
  /** af-markdown-editor's older saves put each pipe row in its own paragraph; recover those rectangular tables. */
  recoverSpacedTables?: boolean;
  /** Told about each link or image shown as typed. */
  onRefused?: (refusal: Refusal) => void;
}
/** A caller's name for a kind of link (a person mention, a session mention), written as `data-mx-link`. */
export type LinkClassifier = (href: string) => string | null;
export interface RenderOptions {
  /** What goes in `<img src>` for an image's source; without one, the source as written. */
  imageAddress?: (src: string) => string;
  classifyLink?: LinkClassifier;
}
export interface AsyncRenderOptions extends Omit<RenderOptions, 'imageAddress'> {
  /** May be asynchronous; each distinct source is asked for once. */
  imageAddress?: (src: string) => string | Promise<string>;
}
