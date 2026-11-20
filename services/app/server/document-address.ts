/**
 * WHAT A PAGE ADDRESS NAMES, for the app page served there (./app):
 *
 *  - `candidateDocument(pathname)`: the document `/a/<id>` or a pretty URL names, if any;
 *  - `admitDocumentAddress(request)`: whether this viewer may read the document the address names (404 otherwise,
 *    the STATUS), the canonical address to render it as, and the row it fetched and admitted (`Admitted`);
 *  - `pageBootstrap(request, pathname, admitted, pages)`: the answers the page will ask for first, answered now;
 *  - `anonymousDocumentHead(request, pathname)`: the head a link-preview bot sees, only for an anonymous reader's document.
 */
import { ID_RE, runWithRequest } from '@/lib/platform';
import { type ArtifactRow, canReadArtifact, type PageRead, readPageRow, slugAddress, slugAddressTarget } from '@/lib/artifacts';
import { effectiveRole, requestAccessFacts } from '@/lib/artifact-access';
import { artifactPageAnswer, type ArtifactPageAnswer, documentHeadFor, type DocumentFrame } from '@/lib/document-serving';
import { artifactViewPath, canonicalArtifactPath, parsePrettyPath, type PagesSite } from '@/lib/http';
import { ANONYMOUS_ACTOR } from '@/lib/accounts';
import { sessionActor } from '@/lib/authentication';
import { verifyExportKey } from '@/lib/export';
import { canonicalDocumentUrl, userPageUrlForOwner } from '@/lib/user-pages';
import { canEdit } from '@artifactbin/contracts/sharing';
import { ROUTES } from './routes.generated';

/** Which document, if any, a path names — `/a/<id>` or a pretty URL. */
export function candidateDocument(pathname: string): { id: string } | null {
  pathname = artifactViewPath(pathname);
  const segments = pathname.split('/').filter(Boolean);
  if (segments[0] === 'a') return segments.length === 2 && ID_RE.test(segments[1]) ? { id: segments[1] } : null;
  if (!segments[0]?.startsWith('@')) return null;
  const file = parsePrettyPath(segments.slice(1).map((s) => { try { return decodeURIComponent(s); } catch { return s; } }));
  return file ? { id: file.id } : null;
}

/** A document row this request already fetched and admitted (admitDocumentAddress), and its canonical path when it was computed. */
export interface Admitted { row: ArtifactRow; canonicalPath?: string; revision?: PageRead['revision']; publishedUrl?: string | null; /** The title-slug address it was resolved from, served there as is. */ servedPath?: string }
type Admission = { status: 200 | 404; address?: string; canonical?: string; admitted?: Admitted };

/**
 * A document address the viewer may not read answers 404 — the STATUS, not
 * only the page. "Gone" and "not yours" look alike by design, and a 200
 * carrying a not-found page would be a weaker answer than the one the
 * server-rendered page gave (and is what a crawler, a curl and the gates
 * all read). The SPA renders its own 404 body inside it.
 *
 * The canonical address for a document, when the one the viewer asked for is
 * not it — served IN PLACE, not redirected: the page is rendered as the
 * canonical address and names it (`address`) for the SPA to put in the
 * address bar (solid/lib/heal-address), saving a shared link its round trip. It
 * runs AFTER the ACL, so a private document never leaks its owner to a
 * viewer who cannot read it; a valid export key skips the healing, because a
 * capture must stay at the address it was handed.
 */
export async function admitDocumentAddress(request: Request): Promise<Admission> {
  const url = new URL(request.url);
  const found = candidateDocument(url.pathname);
  const slugged = slugAddress(url.pathname) !== null;
  if (!found && !slugged) return { status: 200 };
  const actor = await sessionActor(request).catch(() => null);
  const admit = async (id: string, bySlug: boolean): Promise<Admission> => {
    // The row and its live revision in one statement (lib/artifacts readPageRow), for the page's answer below.
    const read = await readPageRow(id, { includePersonalOwner: true });
    if (!read) return { status: 404 };
    const { row, revision } = read;
    // A key skips canonical healing, but only a valid key admits the page.
    const key = url.searchParams.get('key');
    if (!url.pathname.endsWith('/edit') && key && verifyExportKey(row.id, key)) return { status: 200, admitted: { row, revision } };
    // The page's answer (artifactPageAnswer) decides this actor's role on this request again: one memo of its access facts serves both.
    const facts = actor ? requestAccessFacts(request, actor, row.id) : undefined;
    const editingDataset = row.format === 'dataset' && url.pathname.endsWith('/edit');
    if (editingDataset && (!actor || !canEdit(await effectiveRole(row, actor, facts)))) return { status: 404 };
    if (!(await canReadArtifact(row, actor ?? ANONYMOUS_ACTOR, facts))) return { status: 404 };
    // Admitted, by this request's own actor: the page's answer reuses the row and this decision.
    if (url.searchParams.has('key')) return { status: 200, admitted: { row, revision } };
    const personalOwner = read.personalOwner;
    const personalHandle = personalOwner?.handle ?? null;
    const canonicalPath = canonicalArtifactPath(row, personalHandle);
    const canonical = canonicalPath + (editingDataset ? '/edit' : '');
    const publishedUrl = row.group_id ? undefined : userPageUrlForOwner(row, personalOwner?.canPublish && personalHandle && row.user_id
      ? { id: row.user_id, handle: personalHandle, kind: 'user' } : null);
    // A title-slug address stays in the address bar: it is the address the person chose to share.
    const servedPath = bySlug ? artifactViewPath(url.pathname) : undefined;
    return { status: 200, admitted: { row, canonicalPath, revision, publishedUrl, ...(servedPath ? { servedPath } : {}) }, canonical: await canonicalDocumentUrl(row, personalHandle), ...(!bySlug && canonical !== url.pathname ? { address: canonical } : {}) };
  };
  const byId = found ? await admit(found.id, false) : { status: 404 as const };
  if (byId.status === 200 || !slugged) return byId;
  // The id named nothing this viewer reads: the address may be a title slug (lib/artifacts/slug-address).
  const id = await slugAddressTarget(request, url.pathname, actor ?? ANONYMOUS_ACTOR);
  return id && id !== found?.id ? admit(id, true) : byId;
}

const profileData = ROUTES.find((r) => r.dir === '/api/page/profile/[user]/[[...path]]')?.module.GET as ((request: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>) | undefined;

/** What the page inlines (`data`), and for a document its frame and which renderer is in it. */
export type Bootstrap = { data: { path: string; profile?: unknown; artifact?: unknown }; frame?: DocumentFrame; reader?: ArtifactPageAnswer['reader'] };
/** The document parts of an answer the page serves: the document's frame, and which renderer is in it. */
const documentParts = (answer: ArtifactPageAnswer | null): Omit<Bootstrap, 'data'> => (answer ? {
  ...(answer.frame ? { frame: answer.frame } : {}),
  ...(answer.reader ? { reader: answer.reader } : {}),
} : {});

/**
 * What this address will be asked for, answered now. A pretty URL that names
 * a document carries BOTH answers — the resolution and the document page —
 * because the profile page renders the artifact page, and one missing answer
 * is one round trip and one visible settle. A document's answer comes with
 * the story its runtime renders (lib/artifact-page), which the page inlines.
 */
export async function pageBootstrap(request: Request, pathname: string, admitted: Admitted | undefined, pages: PagesSite): Promise<Bootstrap | null> {
  // The ORIGINAL request answers, whatever path it is rendered as: its actor rides on the object (utils inProcess).
  const segments = pathname.split('/').filter(Boolean);
  // The row admitDocumentAddress already fetched and admitted for this request rides along: one fetch, one check.
  const document = async (id: string) => {
    const answer = await runWithRequest(request, () => artifactPageAnswer(request, id, {
      admitted: admitted?.row, admittedRevision: admitted?.revision, admittedCanonical: admitted?.canonicalPath, admittedPublishedUrl: admitted?.publishedUrl, pages,
    }));
    return answer.status === 200 ? answer : null;
  };
  if (segments.at(-1) === 'edit' || (segments[0] === 'a' && segments.length === 3 && segments[2] === 'app')) segments.pop();
  if (segments[0] === 'a' && segments.length === 2) {
    const artifact = await document(segments[1]!);
    return artifact ? { data: { path: pathname, artifact: artifact.body }, ...documentParts(artifact) } : null;
  }
  if (segments[0]?.startsWith('@')) {
    /*
     * The document's own canonical address, already fetched and admitted for this request: the
     * resolution is the profile route's own answer for it (`{ kind: 'artifact', id }`), without a
     * second fetch of the row or a second admission.
     */
    const own = admitted !== undefined && [admitted.canonicalPath, admitted.servedPath].includes(`/${segments.join('/')}`);
    const res = own || !profileData ? null : await runWithRequest(request, () => profileData(request, { params: Promise.resolve({ user: segments[0]!, ...(segments.length > 1 ? { path: segments.slice(1).join('/') } : {}) }) }));
    const profile = own ? { kind: 'artifact', id: admitted!.row.id } : res?.ok ? await res.json() as { kind?: string; id?: string } : null;
    if (!profile) return null;
    const artifact = profile.kind === 'artifact' && profile.id ? await document(profile.id) : null;
    return { data: { path: pathname, profile, ...(artifact ? { artifact: artifact.body } : {}) }, ...documentParts(artifact) };
  }
  return null;
}

/** The head a link-preview bot sees for a document address: only for a document an ANONYMOUS reader may read. */
export async function anonymousDocumentHead(request: Request, pathname: string): Promise<string> {
  const id = candidateDocument(pathname)?.id ?? (slugAddress(pathname) ? await slugAddressTarget(request, pathname, ANONYMOUS_ACTOR) : null);
  const read = id ? await readPageRow(id) : null;
  return read && await canReadArtifact(read.row, ANONYMOUS_ACTOR) ? documentHeadFor(read.row) : '';
}
