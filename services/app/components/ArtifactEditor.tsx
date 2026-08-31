'use client';

/**
 * The owner's gate into editing, mounted BY the artifact page (/a/<id>) when
 * edit mode is on — not a route of its own, so a document has exactly one URL.
 *
 * Everything below it is one editor, because there is one document format:
 * InPlaceEditor, which makes the document the page is already showing
 * source. What remains here is the part that is NOT editing —
 * deciding whether this browser may write at all:
 *
 *   one GET /api/my/artifacts/<id>, authorized by whichever browser credential
 *   the cookie carries (account session or agent session), else the
 *   paste-a-token prompt.
 *
 * There is NO save button: changes persist through the concurrent-edit
 * protocol shortly after they stop arriving, and every way OUT drains first
 * (the flush ref below, published up to the page).
 */
import { Home, Lock } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import InPlaceEditor from '@/components/InPlaceEditor';
import type { StoryEditSelection } from '@/lib/story-runtime/contract';
import type { StoryIslandDataflow } from '@/lib/story-runtime/contract';
import { Button, LINK, PANEL, TokenInput } from '@/components/ui';
import type { EditorFlushRef } from '@/lib/story/use-live-edits';
import { adoptToken } from '@/lib/browser-session';

interface Loaded {
  id: string;
  title: string | null;
  markup: string | null;
  theme: string | null;
  version: number;
  /** Head pointer of the edit protocol — every edit this session sends carries it. */
  edit_id: string;
  template?: string | null;
  colorMode?: string | null;
  /**
   * Present when the editor was SEEDED from the page (which holds it); the read
   * API does not return it, so on the background-load path this is undefined and
   * the draft compile supplies the sheet instead.
   */
  compiledCss?: string | null;
  refs?: Array<{ id: string; kind: string }>;
  /** Present when SEEDED from the page: the document's server-run dataflow (see JsxEditorArtifact). */
  dataflow?: StoryIslandDataflow | null;
}


/**
 * What the PAGE already rendered. Passing it in means entering edit mode shows
 * the document immediately instead of blanking while the editor re-fetches
 * what the server just sent — the round trip was the whole "flash".
 */
export interface EditorSeed {
  id: string;
  title: string | null;
  markup: string | null;
  theme: string | null;
  colorMode?: string | null;
  template?: string | null;
  /**
   * The artifact's STORED stylesheet. Without it the canvas renders unstyled
   * until the editor's own draft compile answers — and the page launching the
   * editor already has the right sheet in hand, so there is nothing to wait for.
   */
  compiledCss?: string | null;
  version: number;
  edit_id: string;
  refs?: Array<{ id: string; kind: string }>;
  dataflow?: StoryIslandDataflow | null;
}

export default function ArtifactEditor({ id, seed, onExit, flushRef, frameRef, sessionNonce, initialSelectionPath = null, onComment, onToggleComments, commentsOpen = false, commentCount = 0 }: {
  id: string;
  seed?: EditorSeed;
  onExit: () => void;
  /**
   * Where the reader was in the document when they pressed edit — the editor
   */
  /** The live document's iframe — editing happens IN it, so it is never remounted. */
  frameRef: { current: HTMLIFrameElement | null };
  /** The document's session secret, learned by the page when it announced itself. */
  sessionNonce: string | null;
  /** View-mode text selection to restore once the edit runtime is ready. */
  initialSelectionPath?: string | null;
  /** Comment on the selected node — the page owns the composer and the drain. */
  onComment?: (selection: StoryEditSelection) => void;
  onToggleComments?: () => void;
  commentsOpen?: boolean;
  commentCount?: number;
  /** Where they are NOW, for the document they go back to. */
  /**
   * Where the mounted editor publishes its drain, so the page can empty it
   * before unmounting — the back button leaves edit mode without ever pressing
   * `done`, and an unmount cancels the debounced save.
   */
  flushRef?: EditorFlushRef;
}) {
  const [art, setArt] = useState<Loaded | null>(seed ?? null);
  const [needsToken, setNeedsToken] = useState(false);
  const [pasted, setPasted] = useState('');

  // True until the background load has confirmed write access once.
  const seedRef = useRef(!!seed);

  /**
   * ONE endpoint, because there is one browser credential. `/api/my/*`
   * answers for an account session and for the agent-session cookie alike
   * (lib/agent-session), each in its own scope.
   */
  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/my/artifacts/${id}`);
      if (!res.ok) {
        setNeedsToken(true);
        return;
      }
      setArt((await res.json()) as Loaded);
      setNeedsToken(false);
      seedRef.current = false;
    } catch {
      // A load that cannot even reach the server falls to the unlock prompt,
      // never an unhandled rejection from the mount effect.
      setNeedsToken(true);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * The editor's drain, published to the page. The editing itself lives one
   * level down, so this is a pass-through — but the page must hold a stable
   * ref either way, since it unmounts the editor without asking who it is.
   */
  const childFlush = useRef<(() => Promise<void>) | null>(null);
  useEffect(() => {
    if (!flushRef) return;
    flushRef.current = () => childFlush.current?.() ?? Promise.resolve();
    return () => { flushRef.current = null; };
  }, [flushRef]);

  /**
   * The locked state: someone opened `#edit` on a document they cannot write.
   * A CARD in the middle of the page rather than a heading in the corner — this
   * is a dead end, and a dead end should look deliberate and offer its exits.
   */
  if (needsToken) {
    return (
      <main className="mx-auto mt-16 max-w-md px-6 pb-24">
        <div className={`${PANEL} px-6 py-5`}>
          <div className="flex items-center gap-2">
            <Lock size={13} className="shrink-0 text-muted" />
            <h1 className="font-mono text-sm font-semibold text-fg">this document is locked</h1>
          </div>
          <p className="mt-3 font-sans text-sm leading-relaxed text-muted">
            Only its owner can edit it.{' '}
            {/* Back to THIS artifact in edit mode — there is no separate editor url. */}
            <a
              href={`/login?callbackUrl=${encodeURIComponent(typeof window === 'undefined' ? '/' : `${window.location.pathname}#edit`)}`}
              className={LINK}
            >
              log in
            </a>{' '}
            if it&apos;s on your account, or paste the agent token that created it.
          </p>
          <form
            className="mt-4 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!pasted.trim()) return;
              const token = pasted.trim();
              setPasted('');
              // The token goes to the SERVER and comes back as an httpOnly
              // cookie; the page never keeps it.
              void adoptToken(token).then(() => load());
            }}
          >
            <TokenInput aria-label="Owning token" placeholder="mx_..." value={pasted} onChange={(e) => setPasted(e.target.value)} />
            <Button type="submit" aria-label="Unlock editing">
              unlock
            </Button>
          </form>
          {/* Says what is NOT locked: anyone who can read the page can keep
              reading it — only writing needs the token. Without
              this line "locked" reads as "you cannot see this either". */}
          <p className="mt-3 font-mono text-[11px] leading-relaxed text-faint">
            reading stays open to anyone with the link — only editing needs the token.
          </p>
        </div>

        {/* The two ways out, since neither is reachable from a locked editor:
            the document itself (drop the #edit fragment — no navigation), and home. */}
        <div className="mt-4 flex items-center justify-between font-mono text-xs">
          <button
            type="button"
            aria-label="View this document without editing"
            onClick={onExit}
            className="cursor-pointer rounded-[4px] border border-edge px-2 py-1 text-muted hover:border-edge-bright hover:text-fg"
          >
            view this document
          </button>
          <a
            href="/"
            aria-label="Go home"
            className="inline-flex items-center gap-1.5 rounded-[4px] border border-edge px-2 py-1 text-muted no-underline hover:border-edge-bright hover:text-fg"
          >
            <Home size={12} /> go home
          </a>
        </div>
      </main>
    );
  }

  if (!art) return <p className="mt-10 text-xs text-faint">loading…</p>;

  return (
    <InPlaceEditor
      frameRef={frameRef}
      sessionNonce={sessionNonce}
      art={{
        id: art.id,
        version: art.version,
        edit_id: art.edit_id,
        title: art.title,
        theme: art.theme,
        template: art.template ?? null,
        colorMode: art.colorMode ?? null,
        markup: art.markup ?? '',
        refs: art.refs ?? [],
        compiledCss: art.compiledCss ?? null,
        dataflow: art.dataflow ?? null,
      }}
      flushRef={childFlush}
      initialSelectionPath={initialSelectionPath}
      onComment={onComment}
      onToggleComments={onToggleComments}
      commentsOpen={commentsOpen}
      commentCount={commentCount}
      onDone={onExit}
    />
  );
}
