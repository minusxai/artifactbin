/* @jsxImportSource solid-js */
/**
 * The gate into editing, mounted by the document page when edit
 * mode is on. Seeded by the page it is the in-place editor over the document the page already holds: the editor's
 * door (lib/serving/artifact-page `?part=editor`) answers a writer alone, so a seed IS the admission, and reading
 * the whole document again to ask it would download it twice. Unseeded it decides whether this browser may write
 * at all (one `backend.load()`, authorized by whichever browser credential the cookie carries), else the locked card.
 */
import { createSignal, onMount, Show, type JSX } from 'solid-js';
import House from 'lucide-solid/icons/house';
import Lock from 'lucide-solid/icons/lock';
import type { ArtifactBackend } from '@/lib/artifact-backend/types';
import { Button } from '../ui/Button';
import { Panel } from '../ui/Panel';
import { StatusMessage } from '../ui/StatusMessage';
import InPlaceEditor, { type EditorArtifact, type InPlaceEditorProps } from './InPlaceEditor';

type ArtifactEditorProps = Omit<InPlaceEditorProps, 'art'> & {
  id: string;
  backend: ArtifactBackend;
  /** What the page already holds; absent, the editor waits for the load. */
  seed?: EditorArtifact;
  /**
   * Asked once as a seeded editor opens: false draws the locked card (a seed prefetched earlier may have outlived the
   * access). The seed itself was admitted by the editor door; this is that same admission, repeated, for the cases
   * where time has passed. Absent, the seed is trusted.
   */
  admitted?: () => Promise<boolean>;
  onExit: () => void;
};

export default function ArtifactEditor(props: ArtifactEditorProps): JSX.Element {
  const [art, setArt] = createSignal<EditorArtifact | null>(props.seed ?? null);
  const [locked, setLocked] = createSignal(false);
  // The locked card is this session's whole editor: the page's entry chrome and loading bar end with it.
  const lock = () => { setLocked(true); props.onEditorMount?.(); props.onEditorReady?.(); };
  onMount(() => {
    if (art()) { void props.admitted?.().then((ok) => { if (!ok) lock(); }); return; }
    void props.backend.load().then((head) => {
      if (!head) { lock(); return; }
      setLocked(false);
      setArt({ ...head, template: head.template ?? null, colorMode: head.colorMode ?? null, markup: head.markup ?? '', refs: head.refs ?? [], compiledCss: null, dataflow: null });
    }).catch(lock);
  });
  return (
    <Show when={!locked()} fallback={
      <main class="mx-auto mt-16 max-w-md px-6 pb-24">
        <Panel>
          <div class="flex items-center gap-2">
            <Lock size={13} class="shrink-0 text-muted" />
            <h1 class="font-mono text-sm font-semibold text-fg">this document is locked</h1>
          </div>
          <p class="mt-3 font-sans text-sm leading-relaxed text-muted">
            Only its owner can edit it.{' '}
            <a href={`/login?callbackUrl=${encodeURIComponent(`${window.location.pathname}#edit`)}`} class="text-accent no-underline hover:underline underline-offset-4">log in</a>{' '}
            if it&apos;s on your account.
          </p>
          <p class="mt-3 font-mono text-2xs leading-relaxed text-faint">reading stays open to anyone with the link — only editing needs the account it belongs to.</p>
        </Panel>
        <div class="mt-4 flex items-center justify-between font-mono text-xs">
          <Button variant="secondary" size="sm" aria-label="View this document without editing" onClick={() => props.onExit()}>view this document</Button>
          <a href="/" aria-label="Go home" class="inline-flex h-control-sm items-center gap-1.5 rounded-control border border-edge-bright px-2.5 text-muted no-underline hover:border-accent hover:text-fg"><House size={12} /> go home</a>
        </div>
      </main>
    }>
      <Show when={art()} fallback={<StatusMessage kind="loading" class="mt-10 justify-center">loading…</StatusMessage>}>
        {(loaded) => <InPlaceEditor {...props} art={loaded()} onDone={props.onExit} />}
      </Show>
    </Show>
  );
}
