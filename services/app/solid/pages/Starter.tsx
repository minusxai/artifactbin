/* @jsxImportSource solid-js */
/**
 * THE STARTER — `/a/<id>` while the document still holds the start placeholder (lib/start-placeholder).
 *
 * That version is not compiled for reading (lib/artifact-page `compiledMode`): what a person staring at
 * a brand-new document needs is not the placeholder but the paste for their agent, which is app UI
 * (solid/components/StarterInstructions). Its bar is the document page's own (solid/document/DocumentChrome).
 *
 * Three ways out, all back onto the framed document:
 *  - the first real version arrives on the live stream → reload, keeping the reader's place, into the
 *    compiled reader;
 *  - Edit (the rail, the controls panel, or landing on `#edit`) → `/edit`, which the server serves as the
 *    compiled placeholder with the editor in place (solid/pages/Document);
 *  - a capture never reaches here: a keyed request is compiled.
 */
import { createEffect, createSignal, onMount, onCleanup, Show, type JSX } from 'solid-js';
import { canEdit as canEditRole, canGovern, canAnnotate as canAnnotateRole, type ArtifactRole } from '@/lib/artifacts/share-roles';
import type { Visibility } from '@/lib/artifacts/access';
import { isStartPlaceholder } from '@/lib/serving/start-placeholder';
import { reloadKeepingPlace } from '@/lib/islands/live-update';
import { chooseTheme } from '@/lib/story-runtime/reader-mode';
import { displayTitle } from '@/lib/story/document/title';
import { createHttpBackend } from '@/lib/artifact-backend/http';
import { initialViewWasReported } from '@/web/artifact-view-report';
import type { StoryThemeName } from '@/lib/validation/story-theme-names';
import { loginHref } from '@/lib/http/login-href';
import { replaceDocument } from '../lib/document-navigation';
import { useSession } from '../lib/session';
import { TrustedUi } from '../components/TrustedUi';
import { useChromeVisibility, type Panel } from '../components/PageChrome';
import { StarterInstructions } from '../components/StarterInstructions';
import { DocumentActions } from '../document/DocumentActions';
import { DocumentChrome } from '../document/DocumentChrome';
import { DocumentSharing } from '../document/DocumentSharing';
import { ForkConfirm } from '../document/ForkArtifact';
import { createLiveArtifact } from '../editor/create-live-artifact';
import { prepareBlankReport } from '../lib/blank-report';

export interface StarterAnswer {
  role: ArtifactRole;
  kind: string;
  like?: { liked: boolean; count: number };
  follow?: { userId: string; following: boolean; count: number } | null;
  surface: {
    id: string; editId: string; format: string; title: string | null; version: number; starter: true;
    heading?: string | null; visibility?: Visibility; hasInvitedUsers?: boolean; openAnnotations?: number;
    author?: { username: string | null; id?: string | null; image?: string | null; forkedFrom?: { label: string; href: string | null } | null } | null;
    theme?: StoryThemeName | null; colorMode?: 'light' | 'dark' | null;
    template?: string | null;
  };
}

export function StarterPage(props: { answer: StarterAnswer }): JSX.Element {
  const { session } = useSession();
  const answer = props.answer;
  const surface = answer.surface;
  const id = surface.id;
  const owner = canGovern(answer.role);
  const editable = canEditRole(answer.role);
  const annotatable = canAnnotateRole(answer.role);
  const [panel, setPanel] = createSignal<Panel>(null);
  const [converting, setConverting] = createSignal(false);
  const [conversionError, setConversionError] = createSignal('');
  const continueBlank = async () => {
    if (!editable || converting()) return;
    setConverting(true); setConversionError('');
    try {
      const backend = createHttpBackend(id);
      const head = await backend.load();
      if (!head) throw new Error('Could not open this artifact.');
      const result = await backend.commitEdit(prepareBlankReport(head, surface.editId));
      if (!result.ok) throw new Error(result.status === 409 ? 'This artifact has changed. Reload to see the latest version.' : 'Could not create the blank report. Please try again.');
      reloading = true; // The committed live frame must not race the editor navigation.
      openEditor();
    } catch (error) { setConversionError(error instanceof Error ? error.message : 'Could not create the blank report.'); }
    finally { setConverting(false); }
  };
  const [fork, setFork] = createSignal(false);
  const [sharingOpen, setSharingOpen] = createSignal(false);
  const [membershipRevision, setMembershipRevision] = createSignal(0);
  const [mode, setMode] = createSignal<'light' | 'dark'>(typeof document !== 'undefined' && document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
  const accountSession = () => answer.kind === 'account' || session()?.kind === 'account';

  // The document's bar is this page's: the app's own steps aside.
  const setChromeVisible = useChromeVisibility();
  onMount(() => setChromeVisible?.(false));
  onCleanup(() => setChromeVisible?.(true));

  // ── edit mode lives on the framed placeholder, at `/edit` ──
  const openEditor = () => {
    if (!editable) return;
    replaceDocument(`${window.location.pathname.replace(/\/+$/, '')}/edit${window.location.search}`);
  };
  const syncEditHash = () => { if (window.location.hash === '#edit') openEditor(); };
  onMount(() => {
    syncEditHash();
    window.addEventListener('hashchange', syncEditHash);
    onCleanup(() => window.removeEventListener('hashchange', syncEditHash));
  });

  // ── one view per open (web/artifact-view-report: the served page reports a compiled read itself) ──
  onMount(() => {
    if (initialViewWasReported(document, id)) return;
    document.body.setAttribute('data-mx-view-reported', id);
    void fetch(`/api/page/artifact/${encodeURIComponent(id)}/view`, { method: 'POST', credentials: 'same-origin', keepalive: true }).catch(() => {});
  });

  // ── the first real version turns this page into the framed document ──
  const live = createLiveArtifact({
    backend: createHttpBackend(id), id, initialEditId: surface.editId, initialVersion: surface.version,
    enabled: typeof EventSource === 'function',
  });
  let reloading = false;
  createEffect(() => {
    const frame = live();
    if (converting() || !frame || reloading || frame.format !== 'markup' || isStartPlaceholder(frame.source, frame.version)) return;
    reloading = true;
    reloadKeepingPlace(window);
  });
  const title = () => displayTitle({ title: live()?.title ?? surface.title, heading: surface.heading ?? null });
  const chooseMode = (next: 'light' | 'dark') => { chooseTheme(next); setMode(next); };

  return <>
    <DocumentChrome id={id} title={title} author={surface.author ?? null} follow={answer.follow ?? null}
      like={answer.like ?? { liked: false, count: 0 }} signedIn={accountSession} comments={() => surface.openAnnotations ?? 0}
      canEdit={editable} canFork owner={owner} visibility={surface.visibility} hasInvitedUsers={surface.hasInvitedUsers}
      panel={panel} setPanel={setPanel} mode={mode} onMode={chooseMode}
      // Nothing is written yet to comment on; a reader who may not comment is offered a way in.
      onComment={() => { if (!annotatable) window.location.assign(loginHref(window.location, 'comment')); }}
      onFork={() => setFork(true)} onShare={() => { if (owner) setSharingOpen(true); }} onEdit={openEditor} onMembership={() => setPanel('controls')}
      controls={(close) => <DocumentActions id={id} title={title()} version={live()?.version ?? surface.version}
        owner={owner} canEdit={editable} canAnnotate={false} accountSession={accountSession()}
        like={answer.like ?? { liked: false, count: 0 }} onCommentsChange={() => {}}
        forkedFrom={surface.author?.forkedFrom ?? null} hideFork
        membershipRevision={membershipRevision()} onMembershipChange={() => setMembershipRevision((n) => n + 1)}
        onEdit={() => { close(); openEditor(); }}
        onShare={() => { close(); setSharingOpen(true); }}
        onDeleted={owner ? () => window.location.assign('/') : undefined} />} />
    <TrustedUi overlay layer="navigation">
      <Show when={fork()}><ForkConfirm id={id} title={title()} onClose={() => setFork(false)} /></Show>
      <Show when={sharingOpen()}>
        <DocumentSharing id={id} title={title()} owner={owner} editable={editable} variant="dialog" version={live()?.version ?? surface.version} onClose={() => setSharingOpen(false)} />
      </Show>
    </TrustedUi>
    {/* The starter sits on the app's own dotted page, under the bar. */}
    <div aria-label="Artifact viewport" class="relative min-h-screen">
      <StarterInstructions id={id} template={surface.template} onContinueBlank={editable && !surface.template ? continueBlank : undefined} converting={converting()} conversionError={conversionError()} />
    </div>
  </>;
}
