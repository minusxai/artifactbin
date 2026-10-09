/**
 * THE EDITOR'S ONE SOURCE OF TRUTH: the document source being edited, its undo history, and the only
 * way to change either.
 *
 * Every change goes through one of three doors, each with one fixed sequence:
 *   apply             — a change made HERE (typing, a panel, the source pane): recorded as one undo
 *                       step (grouped typing within 750 ms collapses), queued for saving once, and
 *                       drawn into the document only when the caller asks (`redraw`).
 *   replaceFromRemote — the server's document replaced ours (another person, an agent). Never
 *                       recorded and never queued back; the revision moves so views that hold their
 *                       own copy (the source pane) reload, and it is drawn.
 *   undo / redo       — commit what is still being typed, then move through the history ON TOP of
 *                       whatever arrived remotely; a step that overlaps a remote edit is refused and
 *                       the source is left alone.
 */
import { createSignal, type Accessor } from 'solid-js';
import type { EditorSelectionChange } from '@/lib/editor-engine/bookmark';
import { SourceHistory, type HistoryResult } from '@/lib/editor-engine/history';
import type { PendingChange } from './create-live-edits';

type HistoryOutcome = HistoryResult | { ok: false; reason: 'unavailable'; message: string };

interface EditorSourceApply {
  /** `local`: typed or composed in place. `structural`: a panel, a menu or a key rewrote the tree. */
  origin: 'local' | 'structural';
  /** Consecutive applies in one group within 750 ms are one undo step. */
  group?: string;
  /** The selection before and after (restored by undo/redo) and the annotation change it carries. */
  selection?: EditorSelectionChange;
  /** Draw the new source into the document (a structural change); typing has already drawn itself. */
  redraw?: boolean;
}

interface EditorSource {
  source: Accessor<string>;
  /** Moves when the source was replaced from outside this editor's typing: a remote document, undo, redo. */
  revision: Accessor<number>;
  canUndo: Accessor<boolean>;
  canRedo: Accessor<boolean>;
  /** The source now, untracked: what an edit arriving this instant composes against. */
  current(): string;
  apply(next: string, how: EditorSourceApply): void;
  /** Never recorded in history. */
  replaceFromRemote(next: string, editId: string): void;
  undo(): Promise<HistoryOutcome>;
  redo(): Promise<HistoryOutcome>;
}

interface EditorSourceOptions {
  initial: string;
  /** Persistence: the save-less protocol's queue (solid/editor/create-live-edits). */
  live: { queue(change: PendingChange): void };
  /**
   * Show a source in the document; `editId` names the head a remote document arrived at. `typing`: the
   * change was typed into prose that has drawn itself already (its draft may wait for a pause).
   */
  draw: (source: string, editId?: string, how?: { typing: true }) => void;
  /** Collect anything typed but not yet committed (create-in-place-edit `commitPending`). */
  commitPending: () => Promise<void>;
}

/** How long typing rests before the `source` signal follows it. */
const SOURCE_REST_MS = 600;

export function createEditorSource(o: EditorSourceOptions): EditorSource {
  let current = o.initial;
  const [source, setSource] = createSignal(current);
  const [revision, setRevision] = createSignal(0);
  const history = new SourceHistory();
  const [canUndo, setCanUndo] = createSignal(false);
  const [canRedo, setCanRedo] = createSignal(false);
  const syncHistory = () => { setCanUndo(history.canUndo); setCanRedo(history.canRedo); };
  /**
   * Typing moves `current` at once (every edit composes against it) but the `source` signal only once typing
   * rests: what reads it (title, tables, query cells, settings) parses the whole document, which is not the
   * keystroke's work. Anything else publishes at once.
   */
  let resting: ReturnType<typeof setTimeout> | null = null;
  const publish = () => { if (resting !== null) clearTimeout(resting); resting = null; setSource(current); };
  const set = (next: string, typing = false) => {
    current = next;
    if (!typing) { publish(); return; }
    if (resting !== null) clearTimeout(resting);
    resting = setTimeout(publish, SOURCE_REST_MS);
  };

  const apply: EditorSource['apply'] = (next, how) => {
    if (next === current) return;
    const annotationOps = how.selection?.annotationOperation ? [how.selection.annotationOperation] : undefined;
    history.record(current, next, { group: how.group, before: how.selection?.before, after: how.selection?.after, annotationOps });
    syncHistory();
    const typing = how.origin === 'local' && !!how.group?.startsWith('typing:');
    set(next, typing);
    o.live.queue(annotationOps ? { source: next, annotationOps } : { source: next });
    if (how.redraw) o.draw(next, undefined, typing ? { typing: true } : undefined);
  };

  const replaceFromRemote: EditorSource['replaceFromRemote'] = (next, editId) => {
    set(next);
    setRevision((n) => n + 1);
    o.draw(next, editId);
  };

  const move = async (direction: 'undo' | 'redo'): Promise<HistoryOutcome> => {
    try { await o.commitPending(); } catch (error) {
      return { ok: false, reason: 'unavailable', message: error instanceof Error ? error.message : 'Editor is unavailable.' };
    }
    const result = history[direction](current);
    syncHistory();
    if (!result.ok) return result;
    set(result.source);
    setRevision((n) => n + 1);
    o.live.queue(result.annotationOps ? { source: result.source, annotationOps: result.annotationOps } : { source: result.source });
    o.draw(result.source);
    return result;
  };

  return {
    source, revision, canUndo, canRedo,
    current: () => current,
    apply,
    replaceFromRemote,
    undo: () => move('undo'),
    redo: () => move('redo'),
  };
}
