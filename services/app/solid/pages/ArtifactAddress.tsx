/* @jsxImportSource solid-js */
/**
 * AN ARTIFACT ADDRESS THE SERVER ANSWERED WITHOUT A COMPILED PAGE — `/a/<id>[/edit]` or its pretty alias
 * (solid/App ArtifactRoute, solid/pages/Profile ProfileAliasRoute), once `servedDocumentFrame()` has said
 * this load carries no document frame. The page door's answer (inlined by server/app, or fetched on a
 * client navigation) says what the artifact is, and so which page draws it:
 *
 *  - a folder → its listing (solid/pages/Folder);
 *  - the starter placeholder → the agent instructions (solid/pages/Starter);
 *  - an image, a pdf, a stored file, a viz recipe, a dataset → the data page (solid/pages/ArtifactData);
 *    at `/edit`, a dataset (or an address whose answer this load did not carry) is the dataset editor;
 *  - any other document: a FETCHED answer crosses to the server, whose page for it is the compiled one;
 *    an answer the server inlined without its compiled page is a dead end (the 404 page), never a reload
 *    that would ask for the same answer again.
 */
import { createEffect, lazy, Match, Show, Switch, type JSX } from 'solid-js';
import { useLocation, useParams } from '@solidjs/router';
import type { FolderPage as FolderData } from '@/lib/workspace/folders';
import type { ArtifactRole } from '@/lib/artifacts/share-roles';
import type { AccountWorkspace } from '@/lib/workspace/dashboard';
import { takeBootstrap } from '@/web/bootstrap';
import { replaceDocument } from '../lib/document-navigation';
import { PAGE_COLUMN } from '../components/ui';
import { usePageData } from '../lib/use-page-data';
import { NotFoundPage } from './NotFound';
import type { DataAnswer } from './ArtifactData';
import type { StarterAnswer } from './Starter';

const FolderPage = lazy(() => import('./Folder').then((m) => ({ default: m.FolderPage })));
const ArtifactDataPage = lazy(() => import('./ArtifactData').then((m) => ({ default: m.ArtifactDataPage })));
const StarterPage = lazy(() => import('./Starter').then((m) => ({ default: m.StarterPage })));
const DatasetEditorPage = lazy(() => import('./DatasetEditor').then((m) => ({ default: m.DatasetEditorPage })));

/** The data tiers: every format the app page draws as a value rather than a document. */
export const DATA_FORMATS = ['image', 'pdf', 'file', 'viz', 'dataset'] as const;

interface ArtifactAnswer {
  role: ArtifactRole; kind: string;
  folder?: FolderData; workspace?: AccountWorkspace; ownerUsername?: string | null;
  surface?: { id: string; format: string; starter?: boolean };
}

const isData = (answer: ArtifactAnswer | null | undefined) => !!answer?.surface && (DATA_FORMATS as readonly string[]).includes(answer.surface.format);
const isStarter = (answer: ArtifactAnswer | null | undefined) => answer?.surface?.format === 'markup' && answer.surface.starter === true;

export function ArtifactAddressRoute(props: { id?: string; editing?: boolean }): JSX.Element {
  const params = useParams<{ id: string }>();
  const location = useLocation();
  const id = () => props.id ?? params.id;
  const editing = () => props.editing ?? /\/edit\/?$/.test(location.pathname);
  // The answer the server inlined for THIS address, when there is one: taken once, like every page's.
  const served = takeBootstrap<ArtifactAnswer>(window.location.pathname, 'artifact');
  if (editing()) {
    // `/edit`: a dataset's address is its editor; every other artifact keeps its one page.
    if (served?.folder) return <FolderPage folder={served.folder} role={served.role} workspace={served.workspace} ownerUsername={served.ownerUsername} />;
    if (isStarter(served)) return <StarterPage answer={served as unknown as StarterAnswer} />;
    if (isData(served) && served!.surface!.format !== 'dataset') return <ArtifactDataPage answer={served as unknown as DataAnswer} />;
    return <DatasetEditorPage artifactId={id()} />;
  }
  const page = usePageData<ArtifactAnswer>(() => `/api/page/artifact/${id()}`, { seed: () => served });
  const compiledDocument = () => {
    const answer = page.data();
    return !!answer?.surface && !answer.folder && !isData(answer) && !isStarter(answer);
  };
  createEffect(() => {
    // A document found by a client navigation: the server's page for it is the compiled one.
    if (compiledDocument() && !served) replaceDocument(window.location.pathname + window.location.search + window.location.hash);
  });
  return <Switch fallback={<main aria-label="Loading artifact" class={`${PAGE_COLUMN} mt-8 pb-24`}><Show when={page.error()} fallback="Loading artifact…"><button type="button" aria-label="Retry artifact" onClick={() => void page.refresh(true)}>Could not load artifact. Retry</button></Show></main>}>
    {/* The page door answers a uniform 404 for a missing artifact and a private one alike (lib/artifacts/access): that
        is the not-found page, not a load failure to retry. */}
    <Match when={(page.error() as { status?: number } | undefined)?.status === 404}><NotFoundPage /></Match>
    <Match when={page.data()?.folder}>{(folder) => <FolderPage folder={folder()} role={page.data()!.role} workspace={page.data()?.workspace} ownerUsername={page.data()?.ownerUsername} />}</Match>
    <Match when={isStarter(page.data())}><StarterPage answer={page.data() as unknown as StarterAnswer} /></Match>
    <Match when={isData(page.data())}><ArtifactDataPage answer={page.data() as unknown as DataAnswer} /></Match>
    <Match when={compiledDocument() && served}><NotFoundPage /></Match>
  </Switch>;
}
