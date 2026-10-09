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
