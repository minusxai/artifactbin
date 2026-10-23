/* @jsxImportSource solid-js */
/**
 * AN ARTIFACT ADDRESS THE SERVER ANSWERED WITHOUT A COMPILED PAGE — `/a/<id>[/edit]` or its pretty alias
 * (solid/App ArtifactRoute, solid/pages/ProfileAlias ProfileAliasRoute), once `servedDocumentFrame()` has said
 * this load carries no document frame. The page door's answer (inlined by server/app, or fetched on a
 * client navigation) says what the artifact is, and so which page draws it:
 *
 *  - a folder → its listing (solid/pages/Folder);
 *  - the starter placeholder → the agent instructions (solid/pages/Starter);
 *  - an image, a pdf, a stored file, a viz recipe, a dataset → the data page (solid/pages/ArtifactData);
 *    at `/edit`, a dataset (or an address whose answer this load did not carry) is the dataset editor;
 *  - any other document: the server's page for it is the compiled one, so a CLIENT navigation crosses to the server
 *    without fetching the page payload (solid/lib/artifact-link draws a document link so the router never gets
 *    here). An address that is told nothing about what it is asks the header-only kind door first
 *    (`?part=kind`), then crosses (a document) or fetches the page answer (anything else). A link that knows the
 *    format says so in `location.state` and skips the question. An address the server itself just served and
 *    drew no page for is a dead end (the 404 page, or the load failure of its answer), never a reload that would
 *    ask for the same answer again.
 */
import { Button } from '../ui/Button';
import { createEffect, createMemo, lazy, Match, Show, Switch, untrack, type JSX } from 'solid-js';
import { useLocation, useParams } from '@solidjs/router';
import type { FolderPage as FolderData } from '@/lib/workspace/folders';
import type { ArtifactRole } from '@artifactbin/contracts';
import type { AccountWorkspace } from '@/lib/workspace/dashboard';
import { takeBootstrap } from '@/solid/lib/bootstrap';
import { claimServedPath } from '../lib/served-frame';
import { isDocumentFormat, knownFormat } from '../lib/artifact-link';
import { replaceDocument } from '../lib/document-navigation';
import { PAGE_COLUMN } from '../ui/ui';
import { usePageData } from '../lib/use-page-data';
import { NotFoundPage } from './NotFound';
const StarterPage = lazy(() => import('./Starter').then(m => ({default: m.StarterPage})));
import type { DataAnswer } from './ArtifactData';

const FolderPage = lazy(() => import('./Folder').then((m) => ({ default: m.FolderPage })));
const ArtifactDataPage = lazy(() => import('./ArtifactData').then((m) => ({ default: m.ArtifactDataPage })));
const DatasetEditorPage = lazy(() => import('./DatasetEditor').then((m) => ({ default: m.DatasetEditorPage })));

/** The data tiers: every format the app page draws as a value rather than a document. */
const DATA_FORMATS = ['image', 'pdf', 'file', 'viz', 'dataset'] as const;

interface ArtifactAnswer {
  role: ArtifactRole; kind: string;
  folder?: FolderData; workspace?: AccountWorkspace; ownerUsername?: string | null;
  surface?: { id: string; format: string; starter?: boolean };
}

const isData = (answer: ArtifactAnswer | null | undefined) => !!answer?.surface && (DATA_FORMATS as readonly string[]).includes(answer.surface.format);

export function ArtifactAddressRoute(props: { id?: string; editing?: boolean }): JSX.Element {
  const params = useParams<{ id: string }>();
  const location = useLocation();
  const id = () => props.id ?? params.id;
  const editing = () => props.editing ?? /\/edit\/?$/.test(location.pathname);
  // The answer the server inlined for THIS address, when there is one: taken once, like every page's.
  const served = takeBootstrap<ArtifactAnswer>(location.pathname, 'artifact');
  if (editing()) {
    // `/edit`: a dataset's address is its editor; every other artifact keeps its one page.
    if (served?.folder) return <FolderPage folder={served.folder} role={served.role} workspace={served.workspace} ownerUsername={served.ownerUsername} />;
    if (isData(served) && served!.surface!.format !== 'dataset') return <ArtifactDataPage answer={served as unknown as DataAnswer} />;
    return <DatasetEditorPage artifactId={id()} />;
  }
  // What the artifact is, before anything is fetched for it: told by the link (location.state), or asked of the kind door.
  // Never asked of the address the server itself served (its answer is the page's to draw): that is the reload-loop guard.
  // One route instance serves every `/a/:id` the router moves between, so the guard ends the moment the id changes.
  // The ROUTER's path, never the address bar's: a navigation creates this page before the bar moves, so the bar still says where the client came from.
  let servedId: string | null = untrack(() => served || claimServedPath(location.pathname) ? id() : null);
  const serverAddress = createMemo(() => { if (servedId !== null && id() !== servedId) servedId = null; return servedId !== null; });
  const told = () => knownFormat(location.state);
  const kind = usePageData<{ format: string }>(() => `/api/page/artifact/${id()}?part=kind`, { enabled: () => !serverAddress() && !told() });
  const format = () => told() ?? kind.data()?.format ?? null;
  const crossing = () => !serverAddress() && isDocumentFormat(format());
  const page = usePageData<ArtifactAnswer>(() => `/api/page/artifact/${id()}`, { seed: () => served, enabled: () => serverAddress() || (format() !== null && !crossing()) });
  const compiledDocument = () => {
    const answer = page.data();
    return !!answer?.surface && !answer.folder && !isData(answer) && answer.surface.format === 'html' && !answer.surface.starter;
  };
  createEffect(() => {
    // A document found by a client navigation: the server's page for it is the compiled one.
    // (`|| compiledDocument()`: a link that named the wrong format still ends where the server's page is.)
    if (crossing() || (compiledDocument() && !serverAddress())) replaceDocument(window.location.pathname + window.location.search + window.location.hash);
  });
  const failure = () => (kind.error() ?? page.error()) as (Error & { status?: number }) | null;
  return <Switch fallback={<main aria-label="Loading artifact" class={`${PAGE_COLUMN} mt-8 pb-24`}><Show when={failure()} fallback="Loading artifact…"><Button variant="secondary" size="sm" aria-label="Retry artifact" onClick={() => void (kind.error() ? kind : page).refresh(true)}>Could not load artifact. Retry</Button></Show></main>}>
    {/* The page door answers a uniform 404 for a missing artifact and a private one alike (canReadArtifact): that
        is the not-found page, not a load failure to retry. */}
    <Match when={failure()?.status === 404}><NotFoundPage /></Match>
    <Match when={page.data()?.folder}>{(folder) => <FolderPage folder={folder()} role={page.data()!.role} workspace={page.data()?.workspace} ownerUsername={page.data()?.ownerUsername} />}</Match>

    <Match when={page.data()?.surface?.starter}><StarterPage answer={page.data() as unknown as import('./Starter').StarterAnswer} /></Match>
    <Match when={isData(page.data())}><ArtifactDataPage answer={page.data() as unknown as DataAnswer} /></Match>
    <Match when={compiledDocument() && serverAddress()}><NotFoundPage /></Match>
  </Switch>;
}
