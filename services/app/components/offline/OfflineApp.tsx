/**
 * THE OFFLINE FILE'S PAGE — what a downloaded `.html` mounts
 * (lib/offline/entry.tsx): read it, edit it, comment on it, save it, send it on.
 *
 * The same InlineStoryRuntime the app renders a document with, fed from the
 * file instead of the server:
 *  - rows come from the snapshot (lib/offline/snapshot-transport), so a filter
 *    the download precomputed still works and one it did not says so;
 *  - Values the download could not precompute are FROZEN: their controls are
 *    disabled with OFFLINE_FILTER_REASON;
 *  - every write is refused by name (OFFLINE_MUTATION_REASON), so no button
 *    waits on an access check nobody will answer;
 *  - what needs a server to draw at all — maps, managed frames — holds its
 *    space with a "Needs a connection" stand-in linking to the live document.
 *
 *
 * And the site's own editor and comments on top of it, unchanged: every
 * request they make goes to the file's ArtifactBackend (lib/offline/file-backend),
 * which answers from the file and names what needs artifactbin. The page keeps
 * the file as it is now: Save writes it back into the same shell
 * (lib/offline/save-file), a crash buffer keeps unsaved work in the browser
 * (lib/offline/local-state), and "Changes" lists who changed what.
 *
 * The runtime is fed from the file as it was OPENED and never re-fed: the
 * editor updates the document in place, exactly as it does on the site.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from 'react';
import { InlineStoryRuntime, type InlineStoryController } from '@/lib/story-runtime/InlineStoryRuntime';
import {
  STORY_SELECTION_ACTION_MESSAGE, STORY_SELECTION_ACTIONS_MESSAGE, isEditFrameMessage,
  type StoryEditSelection, type StoryIslandData, type StorySelectionActionsMessage,
} from '@/lib/story-runtime/contract';
import { subscribeDocument } from '@/lib/story-runtime/document-endpoint';
import type { PreparedStoryRuntime } from '@/lib/story/prepared-runtime';
import type { StoryThemeName } from '@/lib/validation/atlas-schemas';
import { managedFrameLayout } from '@/lib/story/managed-frame-layout';
import { deckGlHeight } from '@/components/kit/deck-gl';
import { TrustedUi } from '@/components/TrustedUi';
import AnnotationLayer from '@/components/AnnotationLayer';
import ArtifactEditor from '@/components/ArtifactEditor';
import { FeatureGate } from '@/components/FeatureUnavailable';
import { useIsPhoneViewport } from '@/components/MobileSheet';
import { NameDialog } from '@/components/offline/NameDialog';
import { ArtifactBackendProvider } from '@/lib/artifact-backend/context';
import type { ArtifactBackend } from '@/lib/artifact-backend/types';
import { APP_BAR_H, EDIT_BAR_H, RIGHT_RAIL_W } from '@/lib/story/edit-bar';
import { useWideEditViewport } from '@/lib/story/use-edit-panel';
import type { EditorFlushRef } from '@/lib/story/use-live-edits';
import { createFileBackend, fileAssetInliner } from '@/lib/offline/file-backend';
import { OFFLINE_FILTER_REASON, OFFLINE_MUTATION_REASON, type ArtifactFile, type ArtifactFileEdit } from '@/lib/offline/file-format';
import { clearDraft, readDraft, readName, writeDraft, writeName, type Draft } from '@/lib/offline/local-state';
import { saveArtifactFile, suggestedFileName, type SaveHandle } from '@/lib/offline/save-file';

/** Where "Open live version" goes, for the stand-ins drawn deep inside the document. */
const LiveUrl = createContext<string>('');

/** What a placeholder says in place of an embed that needs the server. */
export const NEEDS_CONNECTION = 'Needs a connection';

function NeedsConnection({ label, height, id, ast }: { label: string; height: number; id?: unknown; ast?: unknown }) {
  const liveUrl = useContext(LiveUrl);
  return (
    <div
      id={typeof id === 'string' ? id : undefined}
      data-mx-ast={typeof ast === 'string' ? ast : undefined}
      role="figure"
      aria-label={`${label}: ${NEEDS_CONNECTION.toLowerCase()}`}
      data-afbin-offline-placeholder=""
      style={{
        height, width: '100%', boxSizing: 'border-box', display: 'flex', alignItems: 'center', justifyContent: 'center',
        border: '1px dashed var(--border, rgba(128,128,128,0.4))', borderRadius: 8,
        background: 'color-mix(in srgb, var(--muted-foreground, gray) 6%, transparent)',
        color: 'var(--muted-foreground, graytext)', font: '500 13px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif',
      }}
    >
      <span>{NEEDS_CONNECTION} · <a href={liveUrl} rel="noreferrer" target="_blank" style={{ color: 'inherit', textDecoration: 'underline' }}>Open live version</a></span>
    </div>
  );
}

/*
 * Module-level and therefore STABLE: StoryRuntimeApp rebuilds its registry
 * when this object changes, and a rebuilt registry remounts every embed.
 */
const OFFLINE_COMPONENTS: Readonly<Record<string, ComponentType<Record<string, unknown>>>> = {
  DeckGL: (props) => (
    <NeedsConnection label={typeof props.title === 'string' && props.title ? props.title : 'Map'} height={deckGlHeight(props.height)} id={props.id} ast={props['data-mx-ast']} />
  ),
  Iframe: (props) => {
    const { label, pixels } = managedFrameLayout(props.title, props.height);
    return <NeedsConnection label={label} height={pixels} id={props.id} ast={props['data-mx-ast']} />;
  },
};

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const formatWhen = (iso: string) => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : dateFormat.format(date);
};

const DOCUMENT_GROUND = { light: '#ffffff', dark: '#0b0b0c' } as const;

/** The Save button's reason when there is nothing to write. */
export const NOTHING_TO_SAVE = 'No changes to save';
export const UNSAVED = 'Unsaved changes';
/** How long typing and commenting settle before the crash buffer is written. */
const DRAFT_DEBOUNCE_MS = 800;

const BAR_BUTTON = 'inline-flex h-7 cursor-pointer items-center gap-1 rounded-[4px] border border-edge px-2 font-sans text-xs text-fg hover:border-edge-bright disabled:cursor-default disabled:opacity-50';

export function OfflineTopBar({ file, children }: { file: ArtifactFile; children?: ReactNode }) {
  return (
    <TrustedUi>
      <header aria-label="Offline copy" style={{ minHeight: APP_BAR_H }} className="fixed inset-x-0 top-0 z-40 flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-edge bg-surface px-4 py-2 font-sans text-xs text-muted">
        <span>Offline copy of <strong className="font-medium text-fg">{file.metadata.title}</strong></span>
        <span aria-hidden="true">·</span>
        <span>data as of <time dateTime={file.snapshot.at}>{formatWhen(file.snapshot.at)}</time></span>
        <span aria-hidden="true">·</span>
        <a href={file.liveUrl} rel="noreferrer" className="text-fg underline underline-offset-2">Open live version</a>
        {children ? <span className="ml-auto flex flex-wrap items-center gap-2">{children}</span> : null}
      </header>
    </TrustedUi>
  );
}

/** Who changed what in this file, newest first — so the next person sees what their friends did. */
function ChangesList({ journal, onClose }: { journal: ArtifactFileEdit[]; onClose: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    // The navigation layer, above the editor's toolbar and panels, which open below the bar.
    <TrustedUi overlay layer="navigation">
    <section aria-label="Changes in this file" style={{ top: APP_BAR_H + 4 }} className="fixed right-4 z-50 max-h-[60vh] w-80 overflow-y-auto rounded-md border border-edge-bright bg-surface p-3 font-sans text-xs text-fg shadow-xl">
      {journal.length === 0 ? (
        <p className="text-muted">No changes yet. Edits made in this file are listed here with who made them.</p>
      ) : (
        <ol className="space-y-2">
          {[...journal].reverse().map((entry, i) => (
            <li key={`${entry.at}-${i}`} className="leading-snug">
              <span className="font-medium">{entry.by}</span>{' '}
              <span className="text-muted">· <time dateTime={entry.at}>{formatWhen(entry.at)}</time></span>
              <div>{entry.summary}</div>
            </li>
          ))}
        </ol>
      )}
    </section>
    </TrustedUi>
  );
}

/** "Restore unsaved changes from <time>?" — the crash buffer, offered once when the file opens. */
function RestoreDraft({ draft, onRestore, onDiscard }: { draft: Draft; onRestore: () => void; onDiscard: () => void }) {
  return (
    <TrustedUi overlay layer="navigation">
      <div role="alertdialog" aria-label="Unsaved changes found" className="fixed inset-x-0 bottom-4 z-50 mx-auto flex w-fit max-w-[calc(100vw-2rem)] flex-wrap items-center gap-3 rounded-md border border-edge-bright bg-surface px-4 py-3 font-sans text-sm text-fg shadow-xl">
        <span>Restore unsaved changes from <time dateTime={draft.savedAt}>{formatWhen(draft.savedAt)}</time>?</span>
        <button type="button" className={BAR_BUTTON} onClick={onRestore}>Restore</button>
        <button type="button" className={BAR_BUTTON} onClick={onDiscard}>Discard</button>
      </div>
    </TrustedUi>
  );
}

/** The capability the page grants the selection bubble: edit and comment, in view mode. */
const selectionActions = (viewing: boolean) => ({ edit: viewing, annotate: viewing });

/**
 * The file's page. `code` is the file's own `#afbin-code` text, written back
 * unchanged by Save; `fileName` is what Save suggests.
 */
export function OfflineApp({ file, code = '', fileName }: { file: ArtifactFile; code?: string; fileName?: string }) {
  const [opened, setOpened] = useState<{ file: ArtifactFile; generation: number; restored: boolean }>({ file, generation: 0, restored: false });
  const [draft, setDraft] = useState<Draft | null>(() => readDraft(file));
  return (
    <>
      <OfflineSurface key={opened.generation} file={opened.file} restored={opened.restored} code={code} fileName={fileName ?? suggestedFileName(file.metadata.title)} />
      {draft && (
        <RestoreDraft
          draft={draft}
          onRestore={() => { setOpened((o) => ({ file: draft.file, generation: o.generation + 1, restored: true })); setDraft(null); }}
          onDiscard={() => { clearDraft(file); setDraft(null); }}
        />
      )}
    </>
  );
}

function OfflineSurface({ file, restored, code, fileName }: { file: ArtifactFile; restored: boolean; code: string; fileName: string }) {
  const runtimeRef = useRef<InlineStoryController | null>(null);
  const [sessionNonce, setSessionNonce] = useState<string | null>(null);

  // ── who is writing ────────────────────────────────────────────────────────
  const [name, setName] = useState<string | null>(() => readName());
  const nameRef = useRef(name);
  nameRef.current = name;
  /** Asked (and answered or dismissed) this session: never asked twice in one sitting. */
  const asked = useRef(false);
  const [asking, setAsking] = useState<{ resolve: () => void } | null>(null);
  const ensureName = useCallback(() => {
    if (nameRef.current || asked.current) return Promise.resolve();
    return new Promise<void>((resolve) => setAsking({ resolve }));
  }, []);
  const answer = useCallback((picked: string | null) => {
    asked.current = true;
    if (picked) { writeName(picked); nameRef.current = picked; setName(picked); }
    setAsking((current) => { current?.resolve(); return null; });
  }, []);
  const [renaming, setRenaming] = useState(false);

  // ── the file as it is now ─────────────────────────────────────────────────
  const current = useRef(file);
  const [journal, setJournal] = useState(file.journal);
  const [dirty, setDirty] = useState(restored);
  const draftTimer = useRef(0);
  const backend = useMemo(() => createFileBackend(file, {
    author: () => nameRef.current,
    onChange: (next) => {
      current.current = next;
      setJournal(next.journal);
      setDirty(true);
      window.clearTimeout(draftTimer.current);
      draftTimer.current = window.setTimeout(() => writeDraft(current.current), DRAFT_DEBOUNCE_MS);
    },
  }), [file]);
  useEffect(() => () => window.clearTimeout(draftTimer.current), []);
  /** The first comment or reply asks for a name before it is written. */
  const surfaceBackend = useMemo<ArtifactBackend>(() => ({
    ...backend,
    createAnnotation: async (body, key) => { await ensureName(); return backend.createAnnotation(body, key); },
    actOnAnnotation: async (id, action) => { if (action.reply) await ensureName(); return backend.actOnAnnotation(id, action); },
  }), [backend, ensureName]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  // ── the runtime, fed once from the file as opened ────────────────────────
  /*
   * The store starts from the SNAPSHOT's state, whatever the island carried:
   * the transport answers "unchanged" by comparing with those same base
   * values, so both sides must agree on what the base is.
   */
  const data = useMemo<StoryIslandData>(() => {
    const flow = file.island.dataflow?.flow;
    return flow ? { ...file.island, dataflow: { flow, state: file.snapshot.state } } : file.island;
  }, [file]);
  const prepared = useMemo<PreparedStoryRuntime>(() => ({
    data, baseCss: file.css.base, compiledCss: file.css.compiled, authorCss: file.css.author, authorScript: null,
    theme: file.metadata.theme as StoryThemeName | null, title: file.metadata.title,
  }), [data, file]);
  /** The snapshot over the declarations as they are NOW (an edited query says it needs a connection). */
  const transportFactory = useCallback(() => backend.queryTransport(), [backend]);
  const frozenValues = useMemo(() => Object.fromEntries(file.snapshot.frozen.map((value) => [value, OFFLINE_FILTER_REASON])), [file]);
  /*
   * The editor talks to the runtime through this ref. What it pushes names web
   * images by their artifactbin address; the file carries those bytes, so each
   * command is given them back on the way through (fileAssetInliner).
   */
  const inlineAssets = useMemo(() => fileAssetInliner(file), [file]);
  const onController = useCallback((next: InlineStoryController | null) => {
    runtimeRef.current = next && { ...next, send: (command: unknown) => next.send(inlineAssets(command)) };
    setSessionNonce(next?.nonce ?? null);
  }, [inlineAssets]);

  // ── editing ───────────────────────────────────────────────────────────────
  const [editing, setEditing] = useState(false);
  const [initialEditPath, setInitialEditPath] = useState<string | null>(null);
  const editorFlush: EditorFlushRef = useRef<(() => Promise<void>) | null>(null);
  const drainEditor = useCallback(async () => {
    const flush = editorFlush.current;
    if (flush) await Promise.race([flush(), new Promise((resolve) => setTimeout(resolve, 3000))]);
  }, []);
  const beginEdit = useCallback(async (path: string | null) => {
    await ensureName();
    setInitialEditPath(path);
    setEditing(true);
  }, [ensureName]);
  const finishEdit = useCallback(async () => {
    await drainEditor();
    setEditing(false);
    setInitialEditPath(null);
  }, [drainEditor]);

  // ── comments ──────────────────────────────────────────────────────────────
  const [railOpen, setRailOpen] = useState(false);
  const [initialAnnotation, setInitialAnnotation] = useState<StoryEditSelection | null>(null);
  const [openCount, setOpenCount] = useState(() => file.threads.filter((t) => t.status === 'open').length);
  const onAnnotationsChange = useCallback((list: ArtifactFile['threads']) => setOpenCount(list.filter((t) => t.status === 'open').length), []);

  // The page decides which selection actions the document's bubble offers, as the site's page does.
  useEffect(() => {
    if (!sessionNonce) return;
    runtimeRef.current?.send({ type: STORY_SELECTION_ACTIONS_MESSAGE, ...selectionActions(!editing) } satisfies StorySelectionActionsMessage);
  }, [sessionNonce, editing]);
  useEffect(() => subscribeDocument({ runtimeRef }, (event) => {
    if (!sessionNonce || !isEditFrameMessage(event.data, sessionNonce) || event.data.type !== STORY_SELECTION_ACTION_MESSAGE) return;
    if (event.data.action === 'select' || !selectionActions(!editing)[event.data.action]) return;
    if (event.data.action === 'edit') void beginEdit(event.data.selection.path);
    else setInitialAnnotation(event.data.selection);
  }), [sessionNonce, editing, beginEdit]);

  // ── saving ────────────────────────────────────────────────────────────────
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const handle = useRef<SaveHandle | null>(null);
  const save = useCallback(async () => {
    setSaving(true);
    setSaveError(null);
    try {
      await drainEditor();
      const result = await saveArtifactFile({ file: current.current, code, name: fileName, handle: handle.current });
      if (result.outcome === 'cancelled') return;
      handle.current = result.handle;
      window.clearTimeout(draftTimer.current);
      clearDraft(current.current);
      setDirty(false);
    } catch (error) {
      handle.current = null;
      setSaveError(error instanceof Error && error.message ? `Could not save: ${error.message}` : 'Could not save this file.');
    } finally {
      setSaving(false);
    }
  }, [code, fileName, drainEditor]);

  // ── layout ────────────────────────────────────────────────────────────────
  const phone = useIsPhoneViewport();
  const wideEdit = useWideEditViewport();
  const [editorRightInset, setEditorRightInset] = useState(0);
  const [commentsHost, setCommentsHost] = useState<HTMLElement | null>(null);
  const [changesOpen, setChangesOpen] = useState(false);
  const closeChanges = useCallback(() => setChangesOpen(false), []);
  const topOffset = APP_BAR_H + (editing ? EDIT_BAR_H : 0);
  const rightInset = editing ? (wideEdit ? editorRightInset : 0) : railOpen && !phone ? RIGHT_RAIL_W : 0;

  return (
    <ArtifactBackendProvider backend={surfaceBackend}>
      <LiveUrl.Provider value={file.liveUrl}>
        <OfflineTopBar file={file}>
          <span className="relative flex items-center gap-2">
            {dirty && <span role="status" className="text-accent">{UNSAVED}</span>}
            {saveError && <span role="alert" className="text-danger">{saveError}</span>}
            <button type="button" className={BAR_BUTTON} aria-label={name ? `You are ${name}. Change your name` : 'Set your name'} onClick={() => setRenaming(true)}>
              {name ? <>You: <strong className="font-medium">{name}</strong></> : 'Set your name'}
            </button>
            <button type="button" className={BAR_BUTTON} aria-expanded={changesOpen} onClick={() => setChangesOpen((open) => !open)}>
              Changes{journal.length ? ` (${journal.length})` : ''}
            </button>
            {changesOpen && <ChangesList journal={journal} onClose={closeChanges} />}
            <button type="button" className={BAR_BUTTON} aria-pressed={railOpen} onClick={() => setRailOpen((open) => !open)}>
              Comments{openCount ? ` (${openCount})` : ''}
            </button>
            <button type="button" className={BAR_BUTTON} aria-pressed={editing} onClick={() => { if (editing) void finishEdit(); else void beginEdit(null); }}>
              {editing ? 'Done editing' : 'Edit'}
            </button>
            <FeatureGate reason={dirty ? null : NOTHING_TO_SAVE}>
              {(unavailable) => (
                <button type="button" className={`${BAR_BUTTON} border-accent/50 text-accent`} disabled={saving || !!unavailable.disabled} aria-describedby={unavailable['aria-describedby']} onClick={() => void save()}>
                  {saving ? 'Saving…' : 'Save'}
                </button>
              )}
            </FeatureGate>
          </span>
        </OfflineTopBar>
        <main aria-label={file.metadata.title} style={{ background: DOCUMENT_GROUND[data.colorMode === 'dark' ? 'dark' : 'light'], minHeight: '100vh', paddingTop: topOffset, paddingRight: rightInset, paddingBottom: editing && !wideEdit ? '50vh' : 0 }}>
          <InlineStoryRuntime
            data={data}
            prepared={prepared}
            transportFactory={transportFactory}
            writesUnavailable={OFFLINE_MUTATION_REASON}
            frozenValues={frozenValues}
            components={OFFLINE_COMPONENTS}
            onController={onController}
          />
        </main>
        <TrustedUi overlay>
          <AnnotationLayer
            id={file.artifactId}
            runtimeRef={runtimeRef}
            sessionNonce={sessionNonce}
            railOpen={railOpen}
            liveAnnotations={null}
            showViewComments
            onRailOpenChange={setRailOpen}
            initialSelection={initialAnnotation}
            pickOnOpen={!editing}
            topOffset={topOffset}
            onAnnotationsChange={onAnnotationsChange}
            railHost={editing && wideEdit ? commentsHost : undefined}
            railSheet={editing && !wideEdit}
            panelWidth={editing && wideEdit ? editorRightInset : undefined}
          />
          {editing && (
            <ArtifactEditor
              id={file.artifactId}
              onExit={() => void finishEdit()}
              flushRef={editorFlush}
              runtimeRef={runtimeRef}
              sessionNonce={sessionNonce}
              initialSelectionPath={initialEditPath}
              onComment={setInitialAnnotation}
              onRightInsetChange={setEditorRightInset}
              commentsOpen={railOpen}
              onCommentsOpenChange={setRailOpen}
              onCommentsHost={setCommentsHost}
            />
          )}
        </TrustedUi>
        {(asking || renaming) && (
          <TrustedUi overlay layer="modal">
            <NameDialog
              initial={name}
              onSave={(picked) => { setRenaming(false); answer(picked); }}
              onCancel={() => { setRenaming(false); answer(null); }}
            />
          </TrustedUi>
        )}
      </LiveUrl.Provider>
    </ArtifactBackendProvider>
  );
}

/** What the file shows when it cannot be read (ArtifactFileError's reader-facing message). */
export function OfflineFileError({ message }: { message: string }) {
  return (
    <p role="alert" style={{ font: '14px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif', padding: '48px 16px', textAlign: 'center', margin: 0 }}>
      {message}
    </p>
  );
}
