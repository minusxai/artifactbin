/**
 * The `<Mermaid>` inspector's shapes (the Number inspector's story-number.ts, for the diagram: its static `code`
 * source and `title`).
 */

/** What the diagram panel renders from: the `<Mermaid>`'s code and title. */
export interface MermaidEmbed {
  code: string;
  title: string | null;
}

/** A PARTIAL edit: absent fields stay untouched; a null title removes the attribute. */
export interface MermaidEmbedEdit {
  code?: string;
  title?: string | null;
}
