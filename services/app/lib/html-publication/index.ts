import type {HtmlDeclaredQuery, HtmlPageLink, HtmlPageVersion} from '@artifactbin/contracts/html-page';
import type { AccessActor } from '@/lib/accounts';
import { readableArtifact, readableArtifactHeader } from '@/lib/artifacts';
import { getDb } from '../platform';
import type {HtmlIdentityLedger} from '../html-page';

type RevisionRow = { version: number; meta: Record<string, unknown>; format: string; source?: string | null };

async function archivedHtmlPage(pageId: string, revision: string, includeSource: boolean): Promise<RevisionRow> {
  if (!/^[1-9]\d*$/.test(revision) || !Number.isSafeInteger(Number(revision))) throw new Error('Page revision not found');
  const { rows: [row] } = await (await getDb()).query<RevisionRow>(
    `SELECT v.version, v.meta, v.format${includeSource ? ', v.source' : ''} FROM artifact_versions v
     JOIN artifacts a ON a.id = v.artifact_id AND a.deleted_at IS NULL WHERE v.artifact_id = $1 AND v.version = $2`,
    [pageId, Number(revision)],
  );
  if (!row || row.format !== 'html') throw new Error('Page revision not found');
  return row;
}

function pageHeader(pageId: string, { version, meta }: RevisionRow): Omit<HtmlPageVersion, 'html'> {
  return {
    pageId, version, revision: String(version),
    nextNodeId: (meta.htmlIdentity as HtmlIdentityLedger | undefined)?.nextNodeId ?? 1,
    links: ((meta.htmlLinks ?? []) as HtmlPageLink[]).filter((link) => (link as {kind:string}).kind !== 'backend'),
    queries: (meta.htmlQueries ?? []) as HtmlDeclaredQuery[],
  };
}

/** Original artifact ACL and immutable artifact_versions remain the read authority. */
export async function readHtmlPage(actor: AccessActor, pageId: string, revision?: string): Promise<HtmlPageVersion> {
  const access = await readableArtifact(actor, pageId);
  if (!access || access.row.format !== 'html') throw new Error('Page not found');
  const row = revision === undefined || revision === String(access.row.version)
    ? access.row : await archivedHtmlPage(pageId, revision, true);
  return { ...pageHeader(pageId, row), html: row.source ?? '' };
}

/** SQL needs the revision's bindings and the admitted head for its guards. Neither needs source. */
export async function readHtmlPageHeader(actor: AccessActor, pageId: string, revision?: string) {
  const access = await readableArtifactHeader(actor, pageId);
  if (!access || access.row.format !== 'html') throw new Error('Page not found');
  const head = access.row;
  const row = revision === undefined || revision === String(head.version)
    ? head : await archivedHtmlPage(pageId, revision, false);
  return { page: pageHeader(pageId, row), head };
}

export {planHtmlClone} from './clone';
export {htmlLiveLinks,htmlSharedRevisions,changedHtmlSharedRevisions} from './live';
