export type MdInline =
  | { kind: "text"; text: string }
  | { kind: "strong"; children: MdInline[] }
  | { kind: "em"; children: MdInline[] }
  | { kind: "code"; text: string }
  | { kind: "link"; href: string; children: MdInline[] }
  | { kind: "break" };

export interface MdListItem {
  /** A paragraph, and — one level deep only — a nested list under it. */
  children: MdNode[];
}

export type MdNode =
  | { kind: "paragraph"; children: MdInline[] }
  | { kind: "heading"; level: number; children: MdInline[] }
  | { kind: "code_block"; lang: string | null; text: string }
  | { kind: "list"; ordered: boolean; items: MdListItem[] }
  | { kind: "quote"; children: MdNode[] };
