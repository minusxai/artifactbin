import { ARTIFACT_ID_PATTERN, ARTIFACT_REFERENCE_PATTERN } from '@artifactbin/contracts';
import { artifactIdFromPath } from '@artifactbin/utils/artifact-reference';
import { parseJsx } from '@/lib/jsx';
import { CONTEXT_TAG, splitHelmet } from './helmet';

/** Convert an author-entered Doc link, ID or ref into an ID on this server. */
export function contextDocumentId(input: string, origin: string): string | null {
  const value = input.trim();
  if (ARTIFACT_ID_PATTERN.test(value)) return value;
  const ref = ARTIFACT_REFERENCE_PATTERN.exec(value)?.[1];
  if (ref) return ref;
  try {
    const url = new URL(value, origin);
    return /^https?:$/.test(url.protocol) && url.origin === origin ? artifactIdFromPath(url.pathname) : null;
  } catch { return null; }
}

/** Change only the companion reference, preserving the rest of the authored source. */
export function writeContextRef(source: string, id: string | null): string {
  if (id !== null && !ARTIFACT_ID_PATTERN.test(id)) throw new Error('Invalid document ID.');
  const parsed = parseJsx(source);
  if (!parsed.ok) throw new Error('Fix the source before changing context.');
  const { helmet } = splitHelmet(parsed.nodes);
  const markup = id ? `<Context src="ref:${id}" />` : '';
  if (!helmet) return markup ? `<Helmet>${markup}</Helmet>\n${source}` : source;
  if (helmet.selfClosing) return source.slice(0, helmet.start) + `<Helmet>${markup}</Helmet>` + source.slice(helmet.end);
  const at = helmet.end - `</${helmet.tag}>`.length;
  let next = source.slice(0, at) + markup + source.slice(at);
  const removed = helmet.children.filter(node => node.type === 'element' && node.tag === CONTEXT_TAG);
  for (const node of removed.reverse()) next = next.slice(0, node.start) + next.slice(node.end);
  return next;
}
