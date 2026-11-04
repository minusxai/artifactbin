/**
 * THE REGION EDITOR INSIDE THE PAGE FRAME — `@afbin/regions` (build.server), loaded only when the parent opens a region
 * session for an editor (lib/html-runtime/frame-regions), never for readers.
 *
 * It mounts live-regions' ProseMirror editor ON the region's own element, in place, over a Yjs document that starts
 * from the server's state bytes and writes with the server-assigned client id only. Bytes in, bytes out:
 *
 *  · OUT: every local change (the person's typing, and the binding's own untracked repairs) is collected from the
 *    document's updates and posted as ONE merged `region-update` every 50 ms. Nothing is sent while an IME composition
 *    is open: the batch waits for compositionend, so a partial composition never leaves the frame.
 *  · IN: `region-remote` updates are applied under a remote origin (Yjs drops what it already has, so a duplicate or a
 *    resend is harmless). While a composition is open they are held, then applied once it ends.
 *  · Carets: this editor's selection goes out as `region-caret` (relative positions) and `region-blur`; collaborators'
 *    come back as `region-paint` and are drawn by lib/html-bridge/region-carets.
 *  · `/` typed at the start of an empty block says `region-slash` with the caret's place (the menu is the parent's).
 *
 * The parent holds the credentials and does all HTTP; this module never sees either.
 */
import { Plugin, TextSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { applyUpdate, Doc, mergeUpdates } from 'yjs';
import type { RegionFrameMessage, RegionKind } from '@artifactbin/contracts';
import { editorState, regionCommands, regionText } from '../live-regions/browser';
import { captureRegionCaret, createRegionCaretPainter, type RegionCaretPaint } from '../html-bridge/region-carets';
import { installRegionEditorStyles } from './region-editor-styles';

/** How long local changes gather before they are posted as one update. */
export const REGION_BATCH_MS = 50;
/** The attribute that marks an element as a mounted region editor (and scopes its stylesheet). */
export const REGION_EDITOR_ATTR = 'data-af-region-editor';

/** Updates this editor applies from elsewhere: never sent back. */
const REMOTE = Symbol('region-remote');

export interface RegionEditorOptions {
  win: Window;
  /** The region's element (`data-af-editable`), edited in place. */
  root: HTMLElement;
  regionId: string;
  kind: RegionKind;
  /** The server-assigned Yjs client id this session writes with. */
  clientId: number;
  /** The server's full merged state. */
  state: Uint8Array;
  post: (message: RegionFrameMessage) => void;
  /**
   * The person asked for this region: the editor takes the focus, its caret where they pressed (frame viewport) or at
   * the start (null). Absent when the parent opened the session itself: the focus stays where it is.
   */
  at?: { x: number; y: number } | null;
}

export interface RegionEditor {
  /** The ProseMirror view on the region (tests; a later toolbar reads its state). */
  readonly view: EditorView;
  /** A repeat session for this region (the parent reconnected or the stream reset): merged in place. */
  session(clientId: number, state: Uint8Array): void;
  remote(updates: readonly Uint8Array[]): void;
  /** A toolbar or menu command (lib/live-regions regionCommands); false when it does not apply here. */
  command(name: string, args?: Record<string, unknown>): boolean;
  paint(carets: readonly RegionCaretPaint[]): void;
  /** The caret overlay, which page observers ignore. */
  owns(node: Node): boolean;
  /** Sends what is gathered now (unless a composition is open). */
  flush(): void;
  destroy(): void;
}

type Commands = ReturnType<typeof regionCommands>;
/** Toolbar command names → the editor command, from the message's args. */
function commandOf(commands: Commands, name: string, args: Record<string, unknown> = {}) {
  switch (name) {
    case 'strong': case 'em': case 'code': case 'undo': case 'redo': case 'indent': case 'outdent': return commands[name];
    case 'heading': return Number.isInteger(args.level) && (args.level as number) >= 0 && (args.level as number) <= 6 ? commands.heading(args.level as number) : null;
    case 'list': return args.type === 'bullet' || args.type === 'ordered' || args.type === null ? commands.list(args.type) : null;
    case 'quote': return typeof args.on === 'boolean' ? commands.quote(args.on) : null;
    case 'codeBlock': return typeof args.on === 'boolean' ? commands.codeBlock(args.on) : null;
    case 'link': return typeof args.href === 'string' || args.href === null ? commands.link(args.href) : null;
    default: return null;
  }
}

export function mountRegionEditor(options: RegionEditorOptions): RegionEditor {
  const { win, root, regionId, kind, post } = options;
  const doc = new Doc({ gc: false });
  let clientId = options.clientId;
  doc.clientID = clientId;
  applyUpdate(doc, options.state, REMOTE);
  // Yjs moves to a fresh client id when a remote change carries its own; this session's id is the server's.
  const ownId = () => { if (doc.clientID !== clientId) doc.clientID = clientId; };
  ownId();

  // What the element is while it is read: restored exactly when the editor goes.
  const attributes = [...root.attributes].map((attr) => [attr.name, attr.value] as const);
  installRegionEditorStyles(win.document);

  let pending: Uint8Array[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  let held: Uint8Array[] = [];
  let destroyed = false;
  let lastCaret = '';
  let view: EditorView;

  const flush = () => {
    if (timer !== null) { clearTimeout(timer); timer = null; }
    if (destroyed || view.composing || !pending.length) return;
    const update = pending.length === 1 ? pending[0]! : mergeUpdates(pending);
    pending = [];
    post({ kind: 'region-update', regionId, update });
  };
  const schedule = () => { if (timer === null && !destroyed) timer = setTimeout(flush, REGION_BATCH_MS); };
  doc.on('update', (update: Uint8Array, origin: unknown) => { if (origin !== REMOTE) { pending.push(update); schedule(); } });

  const apply = (updates: readonly Uint8Array[]) => {
    if (!updates.length) return;
    applyUpdate(doc, updates.length === 1 ? updates[0]! : mergeUpdates([...updates]), REMOTE);
    ownId();
  };
  /** After a composition: what was held comes in, what was typed goes out. */
  const settle = () => {
    if (destroyed || view.composing) return;
    if (held.length) { const updates = held; held = []; apply(updates); }
    if (pending.length) schedule();
  };

  const caret = () => {
    if (destroyed || !view.hasFocus()) return;
    const message = captureRegionCaret(view.state, regionId);
    const key = JSON.stringify(message);
    if (key !== lastCaret) { lastCaret = key; post(message); }
  };

  let painter: ReturnType<typeof createRegionCaretPainter> | null = null;
  const frame = new Plugin({
    props: {
      attributes: { [REGION_EDITOR_ATTR]: kind },
      handleTextInput(editor, from, to, text) {
        const $from = editor.state.doc.resolve(from);
        if (text === '/' && from === to && $from.parent.isTextblock && !$from.parent.type.spec.code && $from.parent.content.size === 0) {
          let box = { left: 0, bottom: 0 };
          try { box = editor.coordsAtPos(from); } catch { /* no layout */ }
          post({ kind: 'region-slash', regionId, x: box.left, y: box.bottom });
        }
        return false;
      },
      handleDOMEvents: {
        compositionend: () => { setTimeout(settle, 0); return false; },
        focus: () => { setTimeout(caret, 0); return false; },
        blur: () => { lastCaret = ''; post({ kind: 'region-blur' }); return false; },
      },
    },
    // After the binding's own view (it is earlier in the list): the shared text already holds this state.
    view: () => ({
      update: (_view, previous) => {
        painter?.refresh();
        if (held.length && !_view.composing) queueMicrotask(settle);
        if (!previous.selection.eq(_view.state.selection) || !previous.doc.eq(_view.state.doc)) caret();
      },
    }),
  });

  const base = editorState(kind, regionText(doc));
  view = new EditorView({ mount: root }, { state: base.reconfigure({ plugins: [...base.plugins, frame] }) });
  painter = createRegionCaretPainter(view, regionId);

  if (options.at !== undefined) {
    let place: { pos: number } | null = null;
    if (options.at) try { place = view.posAtCoords({ left: options.at.x, top: options.at.y }); } catch { /* no layout */ }
    if (place) view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(place.pos))));
    view.focus();
  }

  return {
    view,
    session(nextClientId, state) {
      clientId = nextClientId;
      ownId();
      if (view.composing) held.push(state); else apply([state]);
    },
    remote(updates) {
      if (view.composing) held.push(...updates); else apply(updates);
    },
    command(name, args) {
      const command = commandOf(regionCommands(kind), name, args);
      if (!command) return false;
      const done = command(view.state, view.dispatch, view);
      view.focus();
      return done;
    },
    paint(carets) { painter?.paint(carets); },
    owns: (node) => !!painter?.owns(node),
    flush,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (timer !== null) clearTimeout(timer);
      painter?.dispose();
      view.destroy();
      doc.destroy();
      for (const attr of [...root.attributes]) root.removeAttribute(attr.name);
      for (const [name, value] of attributes) root.setAttribute(name, value);
    },
  };
}
