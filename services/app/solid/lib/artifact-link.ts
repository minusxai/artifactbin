/**
 * HOW AN IN-APP LINK TO AN ARTIFACT IS DRAWN — the one rule, used by every link that knows the artifact's format
 * (shelves, listings, shared-with-you, a dataset's connected apps, a program's saved page).
 *
 *  - A DOCUMENT (`markup`) is the server's page: its HTML door carries the document's own bootstrap and frame. The link
 *    is `rel="external"`, which the router does not intercept, so a click is ONE full navigation. Intercepting it would
 *    fetch the page payload only to learn it is a document and then cross (solid/pages/ArtifactAddress).
 *  - Every other format is drawn by the app from its page answer. The link stays the router's and carries what it is
 *    in the anchor's `state` attribute (the router passes it to `location.state`), so the address fetches the answer
 *    straight away instead of asking what the artifact is first.
 *  - A link that does not know the format is the router's and carries nothing: the address asks the kind door.
 *
 * Spread the result on the anchor: `<a {...artifactLink(url, row.format)} aria-label=…>`.
 */
import { ARTIFACT_FORMATS, type ArtifactFormat } from '@artifactbin/contracts';

export interface ArtifactLinkAttributes { href: string; rel?: 'external'; state?: string }

export const isDocumentFormat = (format: string | null | undefined): boolean => format === 'html';

const isFormat = (value: unknown): value is ArtifactFormat => typeof value === 'string' && (ARTIFACT_FORMATS as readonly string[]).includes(value);

export function artifactLink(href: string, format?: string | null): ArtifactLinkAttributes {
  if (!isFormat(format)) return { href };
  return isDocumentFormat(format) ? { href, rel: 'external' } : { href, state: JSON.stringify({ format }) };
}

/** The format an in-app link carried in `location.state`, or null: history state is not trusted beyond the known formats. */
export function knownFormat(state: unknown): ArtifactFormat | null {
  const format = (state as { format?: unknown } | null | undefined)?.format;
  return isFormat(format) ? format : null;
}
