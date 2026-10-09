/**
 * THE format vocabulary — the wire, the DB and the pages all speak the same
 * values; `markup` is THE document format and the rest are data tiers.
 *
 * The runtime list and the type are ONE declaration, so a reader that has to
 * ask "is this a format we serve?" (the page, the raw route) cannot drift from
 * the type the wire is checked against.
 */
export const ARTIFACT_FORMATS = ['markup', 'dataset', 'viz', 'image', 'pdf', 'file', 'folder', 'program'] as const;
export type ArtifactFormat = (typeof ARTIFACT_FORMATS)[number];

/**
 * EVERY REQUEST KEY THAT CARRIES CONTENT, named once. The content parser
 * (lib/story/document/input `parseContentInput`) counts them to enforce
 * "exactly one", and the replace door (lib/story/publish/requests) reads the same list
 * to refuse content on a folder — a second spelling there would go stale the
 * first time a tier is added and let that tier through the one door that must
 * not take it.
 */
export const TEXT_CONTENT_FIELDS = ['markup'] as const;
export const DATA_CONTENT_FIELDS = ['dataset', 'sheetUrl', 'csvUrl', 'imageUrl', 'viz', 'image', 'pdf', 'pdfUrl', 'file', 'program'] as const;
export const CONTENT_FIELDS = [...TEXT_CONTENT_FIELDS, ...DATA_CONTENT_FIELDS] as const;
