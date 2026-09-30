/* @jsxImportSource solid-js */
/**
 * components/ArtifactEditor in SOLID — the gate into editing, mounted by the document page when edit
 * mode is on. It decides whether this browser may write at all (one `backend.load()`, authorized by
 * whichever browser credential the cookie carries), else the locked card; otherwise it is the
 * in-place editor over the page's adopted document, seeded with what the page already holds.
 */
import { createSignal, onMount, Show, type JSX } from 'solid-js';
import House from 'lucide-solid/icons/house';
import Lock from 'lucide-solid/icons/lock';
import type { ArtifactBackend } from '@/lib/artifact-backend/types';
import InPlaceEditor, { type EditorArtifact, type InPlaceEditorProps } from './InPlaceEditor';

export type ArtifactEditorProps = Omit<InPlaceEditorProps, 'art'> & {
  id: string;
  backend: ArtifactBackend;
  /** What the page already holds; absent, the editor waits for the load. */
  seed?: EditorArtifact;
  onExit: () => void;
};

export default function ArtifactEditor(props: ArtifactEditorProps): JSX.Element {
  const [art, setArt] = createSignal<EditorArtifact | null>(props.seed ?? null);
  const [locked, setLocked] = createSignal(false);
  onMount(() => {
    void props.backend.load().then((head) => {
      if (!head) { setLocked(true); return; }
      setLocked(false);
      if (!art()) setArt({ ...head, template: head.template ?? null, colorMode: head.colorMode ?? null, markup: head.markup ?? '', refs: head.refs ?? [], compiledCss: null, dataflow: null });
    }).catch(() => setLocked(true));
  });
  return (
    <Show when={!locked()} fallback={
      <main class="mx-auto mt-16 max-w-md px-6 pb-24">
        <div class="rounded-[6px] border border-edge bg-surface px-6 py-5">
          <div class="flex items-center gap-2">
            <Lock size={13} class="shrink-0 text-muted" />
            <h1 class="font-mono text-sm font-semibold text-fg">this document is locked</h1>
          </div>
          <p class="mt-3 font-sans text-sm leading-relaxed text-muted">
            Only its owner can edit it.{' '}
            <a href={`/login?callbackUrl=${encodeURIComponent(`${window.location.pathname}#edit`)}`} class="text-accent no-underline hover:underline underline-offset-4">log in</a>{' '}
            if it&apos;s on your account.
          </p>
          <p class="mt-3 font-mono text-[11px] leading-relaxed text-faint">reading stays open to anyone with the link — only editing needs the account it belongs to.</p>
        </div>
        <div class="mt-4 flex items-center justify-between font-mono text-xs">
          <button type="button" aria-label="View this document without editing" onClick={() => props.onExit()}
            class="cursor-pointer rounded-[4px] border border-edge px-2 py-1 text-muted hover:border-edge-bright hover:text-fg">view this document</button>
          <a href="/" aria-label="Go home" class="inline-flex items-center gap-1.5 rounded-[4px] border border-edge px-2 py-1 text-muted no-underline hover:border-edge-bright hover:text-fg"><House size={12} /> go home</a>
        </div>
      </main>
    }>
      <Show when={art()} fallback={<p class="mt-10 text-xs text-faint">loading…</p>}>
        {(loaded) => <InPlaceEditor {...props} art={loaded()} onDone={props.onExit} />}
      </Show>
    </Show>
  );
}
