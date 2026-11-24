/**
 * Open a document for its current reader before a serving door handles any bytes.
 * Metadata reads can end at a cache hit, a validator or a small page answer. A
 * full open rechecks admission if access moved between the header and the row.
 */
import { NO_IDENTITY, type RequestIdentity } from '@/lib/accounts';
import { effectiveRole, holdsCreatingToken, requestAccessFacts, type AccessFacts } from '@/lib/artifact-access';
import { accessMoved, admitRead, archivedVersionFor, canReadArtifact, currentPage, getArtifactHeaderById, readPageHeader, readPageRow, servedRow, type ArtifactHeader, type PageRead } from '@/lib/artifacts';
import { requestOrSessionActor, sessionActor } from '@/lib/authentication';
import { datasetReadAccess, viewCatalog } from '@/lib/dataset-permissions';
import { liveConnectionOf, publicCatalogOf } from '@/lib/datasets';
import { verifyExportKey } from '@/lib/export';
import { ID_RE } from '@/lib/platform';
import { servesDocument, type UserPagesOwner } from '@/lib/user-pages';
import { canEdit } from '@artifactbin/contracts/sharing';

interface AdmittedDocument {
  header: ArtifactHeader;
  read: PageRead | null;
  actor: RequestIdentity;
  facts: AccessFacts | undefined;
  exporting: boolean;
  live: number;
}

export interface AddressDocument extends AdmittedDocument {
  read: PageRead;
  editingDataset: boolean;
}

type Surface =
  | { surface: 'page' }
  | { surface: 'address'; actor: RequestIdentity | null; requireReader?: true }
  | { surface: 'raw'; actor: RequestIdentity; owner?: UserPagesOwner };

type Options = Surface & { header?: 'only' | 'metadata' | 'row'; opened?: AdmittedDocument };
type NotFound = 'not_found';

export function openDocument(request: Request, id: string, options: Extract<Surface, { surface: 'address' }>): Promise<AddressDocument | NotFound>;
export function openDocument(request: Request, id: string, options: Surface & { header: 'only' | 'metadata' | 'row' }): Promise<AdmittedDocument | NotFound>;
export function openDocument(request: Request, id: string, options: Exclude<Surface, { surface: 'address' }> & { opened?: AdmittedDocument }): Promise<Awaited<ReturnType<typeof readDocument>> | NotFound>;
export async function openDocument(request: Request, id: string, options: Options) {
  if (!ID_RE.test(id)) return 'not_found';
  const { surface } = options;
  const owner = surface === 'raw' ? options.owner : undefined;
  let opened = options.opened?.header.id === id ? options.opened : null;
  if (!opened) {
    const address = surface === 'address';
    const url = new URL(request.url);
    const editing = address && url.pathname.endsWith('/edit');
    const snapshot = options.header === 'metadata' ? await readPageHeader(id) : null;
    const read = address || options.header === 'row' ? await readPageRow(id, { includePersonalOwner: address && !options.requireReader }) : null;
    const header = options.header === 'only' || (!options.header && surface === 'page')
      ? await getArtifactHeaderById(id) : snapshot?.row ?? read?.row;
    if (!header || (owner && !servesDocument(owner, header))) return 'not_found';

    const actor = (surface === 'page' ? await sessionActor(request) : options.actor) ?? NO_IDENTITY;
    const facts = surface === 'raw' ? undefined : requestAccessFacts(request, actor, id);
    const exporting = !owner && verifyExportKey(id, url.searchParams.get('key') ?? undefined);
    const editingDataset = editing && header.format === 'dataset';
    if (editingDataset && !canEdit(await effectiveRole(header, actor, facts))) return 'not_found';
    // The address admits its shell with the account rule. A byte door also
    // honours the creating token, and the raw door accepts explicit bearers.
    const admitted = address
      ? (exporting && !editing && !options.requireReader) || await canReadArtifact(header, actor, facts)
      : await admitRead(header, actor, { facts, exporting });
    if (!admitted) return 'not_found';
    opened = { header, read, actor, facts, exporting, live: snapshot?.live ?? 0 };
    if (address && read) return { ...opened, read, editingDataset };
  }
  if (options.header) return opened;
  return readDocument(request, id, opened, surface === 'raw', Boolean(owner));
}

async function readDocument(request: Request, id: string, opened: AdmittedDocument, raw: boolean, published: boolean) {
  const { header, actor, facts, exporting } = opened;
  const read = opened.read ?? await readPageRow(id);
  if (!read) return 'not_found';
  const artifact = read.row;
  const moved = accessMoved(header, artifact);
  if (moved && !(await admitRead(artifact, actor, { facts, exporting }))) return 'not_found';

  const html = artifact.format === 'html';
  // A publishing host serves its current document. Raw data tiers and folder
  // listings keep their original URL semantics.
  const at = !published && (html || (!raw && artifact.format !== 'folder'))
    ? await archivedVersionFor(request, artifact, () => requestOrSessionActor(request), { capture: exporting })
    : null;
  if (at === 'not_found') return at;
  const page = html && !at ? await currentPage(artifact, { revision: read.revision }) : null;
  const served = raw && !html ? artifact : servedRow(artifact, at);
  const row = page ? { ...served, source: page.row.source, title: page.row.title } : served;

  let dataset = null;
  if (artifact.format === 'dataset') {
    const connection = liveConnectionOf(artifact.meta);
    const accessRow = raw ? header : artifact;
    const decision = connection || exporting || holdsCreatingToken(accessRow, actor) ? null : await datasetReadAccess(accessRow, actor);
    if (decision && !decision.allowed) return 'not_found';
    const catalog = connection && raw ? null : publicCatalogOf(artifact);
    dataset = { connection, decision, catalog: catalog && decision ? viewCatalog(decision, catalog) : catalog };
  }
  const sameHead = !moved && header.version === artifact.version && header.edit_id === artifact.edit_id
    && String(header.updated_at) === String(artifact.updated_at);
  return { ...opened, artifact, row, at, page, dataset, sameHead };
}
