/* @jsxImportSource solid-js */
/**
 * THE COMMENT RAIL: its frame (`RailChrome`) and what it holds (`CommentRail`).
 *
 * The conversation has three homes: the fixed right rail on desktop (the page narrows the document
 * by its width), the editor's panel when it hosts the rail (rendered into it, not as a column of its
 * own), and a half-height bottom sheet on a phone. The content is identical; this wrapper is the
 * only thing that knows the difference. The header — title and the way out — is pinned above the
 * scroll in every home, however long the list gets.
 *
 * `CommentRail` is the conversation inside it: the comment tools (Select, Screenshot) or the way to sign in, the open
 * threads, and the resolved history behind a heading that starts collapsed.
 *
 * Interface: `CommentRail`.
 */
import { For, Show, type JSX } from 'solid-js';
import { Portal } from 'solid-js/web';
import Camera from 'lucide-solid/icons/camera';
import ChevronRight from 'lucide-solid/icons/chevron-right';
import SquareDashedMousePointer from 'lucide-solid/icons/square-dashed-mouse-pointer';
import X from 'lucide-solid/icons/x';
import type { AnnotationWire } from '@/lib/annotations';
import type { ArtifactBackend } from '@/lib/artifact-backend';
import MobileSheet from '../ui/MobileSheet';
import { Button } from '../ui/Button';
import { FeatureGate } from '../components/FeatureGate';
import { RIGHT_RAIL_W } from '@/lib/html-reader/edit-bar';
import { AnnotationThread, type ThreadActions } from './AnnotationThread';
import type { ReplyDrafts } from './reply-drafts';
import type { CommentDraft } from './annotation-draft';
import type { ThreadStore } from './annotation-threads';

function RailChrome(props: {
  phone: boolean;
  /** The editor's panel, when it hosts the rail. */
  host?: HTMLElement;
  topOffset: number;
  onClose: () => void;
  header: JSX.Element;
  children: JSX.Element;
}): JSX.Element {
  return <Show when={!props.phone} fallback={
    <MobileSheet label="Annotation sidebar" onClose={props.onClose} size="half" header={props.header}>
      <div class="flex flex-col gap-2.5">{props.children}</div>
    </MobileSheet>
  }>
    <Show when={props.host} fallback={
      <aside data-capture-chrome aria-label="Annotation sidebar"
        class="fixed bottom-0 right-0 z-20 flex flex-col gap-2.5 border-l border-edge bg-bg p-2.5"
        style={{ top: `${props.topOffset}px`, width: `${RIGHT_RAIL_W}px` }}>
        <div class="shrink-0">{props.header}</div>
        <div class="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto">{props.children}</div>
      </aside>
    }>{(host) => (
      <Portal mount={host()} ref={(wrapper: HTMLElement) => { wrapper.style.display = 'contents'; }}>
        <section data-capture-chrome aria-label="Annotation sidebar" class="flex min-h-0 flex-1 flex-col gap-2.5 bg-bg p-2.5">
          <div class="shrink-0">{props.header}</div>
          <div class="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto">{props.children}</div>
        </section>
      </Portal>
    )}</Show>
  </Show>;
}

export function CommentRail(props: {
  threads: ThreadStore;
  draft: CommentDraft;
  artifactId: string;
  backend: ArtifactBackend;
  mayCreate: boolean;
  canDeleteAny?: boolean;
  /** Where the rail lives (RailChrome). */
  phone: boolean;
  host?: HTMLElement;
  topOffset: number;
  onClose: () => void;
  offerSignIn: boolean;
  hoverId: string | null;
  /** What the document last said about each thread's passage. */
  viewStateError: { id: string; message: string } | null;
  missing: Set<string>;
  replies: ReplyDrafts;
  actions: ThreadActions;
  threadsRef: (element: HTMLDivElement) => void;
}): JSX.Element {
  const { threads, draft } = props;
  const header = () => <div class="space-y-2 border-b border-edge px-1 pb-3 font-sans">
    <div class="flex items-center justify-between">
      <h2 class="font-mono text-micro font-semibold uppercase tracking-[0.12em] text-faint">comments</h2>
      <Button type="button" variant="ghost" size="sm" icon aria-label="Close comments" onClick={() => props.onClose()}><X size={14} strokeWidth={1.8} /></Button>
    </div>
    <Show when={props.mayCreate} fallback={<Show when={props.offerSignIn} fallback={<p class="text-2xs text-muted">You have read-only comment access.</p>}><Button type="button" variant="secondary" size="sm" onClick={() => props.actions.signIn()}>Sign in to comment</Button></Show>}>
    <div role="group" aria-label="Comment tools" class="grid grid-cols-2 gap-2">
      {/* A tool in use is the primary variant; min-h-16 grows the control past its fixed height without fighting it. */}
      <Button type="button" variant={draft.pick() === 'block' ? 'primary' : 'secondary'} size="sm" aria-label="Select" aria-pressed={draft.pick() === 'block'} onClick={draft.toggleSelect}
        class="min-h-16 flex-col py-2">
        <span class="flex items-center gap-2 font-sans text-sm font-semibold"><SquareDashedMousePointer size={18} />Select</span>
        <span class="font-sans text-2xs font-normal">Block or text</span>
      </Button>
      <FeatureGate reason={draft.screenshotUnavailable()} class="flex">
        {(gate) => <Button type="button" variant={draft.capture.required() ? 'primary' : 'secondary'} size="sm" aria-label="Screenshot" aria-pressed={draft.capture.required()} onClick={() => void draft.screenshot()} {...gate}
          class="min-h-16 w-full flex-col py-2">
          <span class="flex items-center gap-2 font-sans text-sm font-semibold"><Camera size={18} />Screenshot</span>
          <span class="font-sans text-2xs font-normal">Capture an area</span>
        </Button>}
      </FeatureGate>
    </div>
    <p class="text-2xs leading-relaxed text-muted">{draft.capture.required() ? 'Share this tab, then drag an area.' : 'Select a block or highlight text to comment.'}</p>
    </Show>
  </div>;

  const thread = (id: string, row: () => AnnotationWire | undefined) => <Show when={row()}>{(annotation) => (
    <AnnotationThread row={annotation()} threads={threads} replies={props.replies} actions={props.actions}
      artifactId={props.artifactId} backend={props.backend} mayCreate={props.mayCreate} canDeleteAny={props.canDeleteAny}
      hovered={props.hoverId === id} targetMissing={props.missing.has(id)}
      viewStateError={props.viewStateError?.id === id ? props.viewStateError.message : undefined} />
  )}</Show>;

  return <RailChrome phone={props.phone} host={props.host} topOffset={props.topOffset} onClose={props.onClose} header={header()}>
    <div ref={props.threadsRef} class="contents">
      <Show when={threads.rows().length === 0 && !draft.selection()}>
        <p class="p-2 font-mono text-xs text-muted">{props.mayCreate ? 'no open comments — select text in the document, or pick a block, to leave one' : 'no open comments'}</p>
      </Show>
      <For each={threads.openIds()}>{(id) => thread(id, () => threads.rows().find((row) => row.id === id))}</For>
      {/* Nothing resolved: no toggle, the heading stays plain and the note below says so. */}
      <div role="separator" aria-labelledby="resolved-annotations-heading" class="mt-1 flex items-center gap-2 px-1">
        <span aria-hidden="true" class="h-px flex-1 bg-edge" />
        <h2 id="resolved-annotations-heading" class="shrink-0 font-mono text-micro font-semibold uppercase tracking-[0.12em] text-faint">
          <Show when={threads.resolvedIds().length > 0} fallback="resolved">
            <Button type="button" variant="ghost" size="xs" aria-expanded={threads.resolvedOpen()} aria-controls="resolved-annotations-list" onClick={threads.toggleResolved}
              class="gap-1 px-1 text-micro! font-semibold! uppercase tracking-[0.12em] text-faint!">
              <ChevronRight aria-hidden="true" class="size-3 transition-transform" classList={{ 'rotate-90': threads.resolvedOpen() }} />
              resolved ({threads.resolvedIds().length})
            </Button>
          </Show>
        </h2>
        <span aria-hidden="true" class="h-px flex-1 bg-edge" />
      </div>
      <div id="resolved-annotations-list" class="contents">
        <Show when={threads.resolvedOpen()}>
          <For each={threads.resolvedIds()}>{(id) => thread(id, () => (threads.resolved() ?? []).find((row) => row.id === id))}</For>
        </Show>
      </div>
      <Show when={(threads.resolved()?.length ?? 0) === 0}>
        <p class="p-2 font-mono text-xs text-muted">nothing resolved yet</p>
      </Show>
    </div>
  </RailChrome>;
}
