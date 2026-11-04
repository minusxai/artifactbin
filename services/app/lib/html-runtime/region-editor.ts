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
 *  · `/` typed at the start of an empty block says `region-slash` with the caret's place (the menu is the parent's);
 *    Mod-K says `region-link` with the link at the caret (the URL dialog is the parent's too).
 *  · Keys typed before the editor mounted (frame-regions holds them) are replayed in order (`replay`), through the
 *    same handlers a real key reaches, so Markdown shortcuts and Enter/Backspace act as they would have.
 *
 * The parent holds the credentials and does all HTTP; this module never sees either.
 */
import { keymap } from 'prosemirror-keymap';
import type { Node as PMNode } from 'prosemirror-model';
import { Plugin, Selection, TextSelection, type Command, type EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { applyUpdate, Doc, mergeUpdates } from 'yjs';
import type { RegionFrameMessage, RegionKind } from '@artifactbin/contracts';
import { editorState, regionCommands, regionText } from '../live-regions/browser';
import { safeHref } from '../live-regions/href';
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
  /** With `at`: place the caret there but leave the focus where it is (the person moved on while the editor loaded). */
  focus?: false;
}

/**
 * A key typed before the editor mounted (frame-regions' buffer): text as the input produced it (`composed` when an IME
 * committed it, inserted whole), or a key the editor acts on (Enter, Backspace, Delete, Tab, Mod-B/I/E).
 */
export type RegionKeyEntry =
  | { text: string; composed?: true }
  | { key: string; code?: string; keyCode?: number; shiftKey?: boolean; altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean };

export interface RegionEditor {
  /** The ProseMirror view on the region (tests; a later toolbar reads its state). */
  readonly view: EditorView;
  /** A repeat session for this region (the parent reconnected or the stream reset): merged in place. */
  session(clientId: number, state: Uint8Array): void;
  remote(updates: readonly Uint8Array[]): void;
  /** A toolbar or menu command (lib/live-regions regionCommands, and the frame's own: see commandOf); false when it does not apply here. */
  command(name: string, args?: Record<string, unknown>): boolean;
  /** Keys typed before the editor mounted, applied in order at the caret as if typed now. */
  replay(entries: readonly RegionKeyEntry[]): void;
  paint(carets: readonly RegionCaretPaint[]): void;
  /** The caret overlay, which page observers ignore. */
  owns(node: Node): boolean;
  /** Sends what is gathered now (unless a composition is open). */
  flush(): void;
  destroy(): void;
}

type Commands = ReturnType<typeof regionCommands>;

/** The top-level text block holding the caret, or null (a rule, or a text region's single line counts too). */
function caretBlock(state: EditorState): PMNode | null {
  const { $head } = state.selection;
  return $head.depth === 1 && $head.parent.isTextblock ? $head.parent : null;
}

/** The link around an empty caret (in it, or at either end): its range in the document and its href, or null. */
function linkAround(state: EditorState): { from: number; to: number; href: string } | null {
  const { $from } = state.selection;
  const type = state.schema.marks.link;
  if (!type || !$from.parent.isTextblock) return null;
  const start = $from.start();
  // Runs of the block's text by link, adjacent pieces of one link (split by another mark) joined.
  const runs: { from: number; to: number; href: string | null }[] = [];
  $from.parent.forEach((child, offset) => {
    const href = (type.isInSet(child.marks)?.attrs.href as string | undefined) ?? null;
    const last = runs.at(-1);
    if (last && last.href === href) last.to = start + offset + child.nodeSize;
    else runs.push({ from: start + offset, to: start + offset + child.nodeSize, href });
  });
  const pos = $from.pos;
  const found = runs.find((run) => run.href && run.from < pos && pos < run.to) ?? runs.find((run) => run.href && (run.to === pos || run.from === pos));
  return found?.href ? { from: found.from, to: found.to, href: found.href } : null;
}

/** The link the caret or selection is in, for Mod-K's dialog. */
function linkAt(state: EditorState): string | null {
  const { selection } = state;
  if (selection.empty) return linkAround(state)?.href ?? null;
  const mark = state.schema.marks.link?.isInSet(state.doc.nodeAt(selection.from)?.marks ?? []);
  return (mark?.attrs.href as string | undefined) ?? null;
}

/**
 * A link with no selection: on a link it changes (or, with null, removes) that whole link; elsewhere a URL goes in as
 * its own linked text. With a selection, the core's link command.
 */
function link(commands: Commands, href: string | null): Command {
  return (state, dispatch, view) => {
    if (!state.selection.empty) return commands.link(href)(state, dispatch, view);
    const type = state.schema.marks.link;
    const safe = href === null ? null : safeHref(href);
    if (!type || (href !== null && !safe) || !caretBlock(state) || caretBlock(state)!.type.spec.code) return false;
    const around = linkAround(state);
    if (around) {
      const tr = state.tr.removeMark(around.from, around.to, type);
      if (safe) tr.addMark(around.from, around.to, type.create({ href: safe }));
      dispatch?.(tr);
      return true;
    }
    if (!safe) return false;
    const { from } = state.selection;
    dispatch?.(state.tr.insertText(safe, from).addMark(from, from + safe.length, type.create({ href: safe })).removeStoredMark(type));
    return true;
  };
}

/**
 * The slash menu chose an item: the `/` the person typed to open it goes. It opened at the start of an empty block, so it
 * is that block's first character, even when keys typed right after the choice reached the text before this command.
 */
const removeSlash: Command = (state, dispatch) => {
  const block = caretBlock(state);
  if (!block || block.textContent[0] !== '/') return false;
  const start = state.selection.$head.start();
  dispatch?.(state.tr.delete(start, start + 1));
  return true;
};

/** A divider before the caret's block (as `---` makes one), which keeps its text and ids; never inside a list. */
const rule: Command = (state, dispatch) => {
  const block = caretBlock(state), type = state.schema.nodes.rule;
  if (!type || !block || block.type.name !== 'textblock' || block.attrs.list) return false;
  const from = state.selection.$head.before(1);
  if (dispatch) { const tr = state.tr.insert(from, type.create({ quote: block.attrs.quote })); dispatch(tr.setSelection(TextSelection.create(tr.doc, from + 2))); }
  return true;
};

/** Plain text: a heading's level goes, and a code block becomes a paragraph again. */
const paragraph = (commands: Commands): Command => (state, dispatch, view) =>
  caretBlock(state)?.type.spec.code ? commands.codeBlock(false)(state, dispatch, view) : commands.heading(0)(state, dispatch, view);

/** Toggles for the keyboard: a second press of the same shortcut puts the block back to plain. */
const toggles = (commands: Commands) => ({
  heading: (level: number): Command => (state, dispatch, view) => commands.heading(caretBlock(state)?.attrs.level === level ? 0 : level)(state, dispatch, view),
  list: (type: 'bullet' | 'ordered'): Command => (state, dispatch, view) => commands.list(caretBlock(state)?.attrs.list === type ? null : type)(state, dispatch, view),
  quote: (): Command => (state, dispatch, view) => commands.quote(!caretBlock(state)?.attrs.quote)(state, dispatch, view),
});

/** Toolbar and menu command names → the editor command, from the message's args. */
function commandOf(commands: Commands, name: string, args: Record<string, unknown> = {}): Command | null {
  switch (name) {
    case 'strong': case 'em': case 'code': case 'undo': case 'redo': case 'indent': case 'outdent': return commands[name];
    case 'heading': return Number.isInteger(args.level) && (args.level as number) >= 0 && (args.level as number) <= 6 ? commands.heading(args.level as number) : null;
    case 'paragraph': return paragraph(commands);
    case 'list': return args.type === 'bullet' || args.type === 'ordered' || args.type === null ? commands.list(args.type) : null;
    case 'quote': return typeof args.on === 'boolean' ? commands.quote(args.on) : null;
    case 'codeBlock': return typeof args.on === 'boolean' ? commands.codeBlock(args.on) : null;
    case 'link': return typeof args.href === 'string' || args.href === null ? link(commands, args.href) : null;
    case 'rule': return rule;
    case 'removeSlash': return removeSlash;
    // Back to the text, the caret where it was, after a menu or dialog closed without acting.
    case 'resume': return () => true;
    // A doc opened without a press: the caret at the start (its title), and the focus.
    case 'focus': return (state, dispatch) => { dispatch?.(state.tr.setSelection(Selection.atStart(state.doc))); return true; };
    default: return null;
  }
}

/** The editor's own keys beyond the core keymap (Google Docs' bindings). */
function shortcuts(kind: RegionKind, commands: Commands, linkRequest: Command) {
  if (kind !== 'rich') return keymap({});
  const toggle = toggles(commands);
  return keymap({
    'Mod-Alt-0': paragraph(commands),
    'Mod-Alt-1': toggle.heading(1),
    'Mod-Alt-2': toggle.heading(2),
    'Mod-Alt-3': toggle.heading(3),
    'Mod-Shift-7': toggle.list('ordered'),
    'Mod-Shift-8': toggle.list('bullet'),
    'Mod-Shift-9': toggle.quote(),
    'Mod-k': linkRequest,
  });
}

/** What the browser itself does for a key no handler took: delete a character (or the selection). */
function defaultKey(state: EditorState, key: string): ReturnType<EditorState['tr']['delete']> | null {
  const { selection } = state;
  if (key !== 'Backspace' && key !== 'Delete') return null;
  if (!selection.empty) return state.tr.deleteSelection();
  const { $from } = selection;
  if (!$from.parent.isTextblock) return null;
  const text = $from.parent.textContent;
  if (key === 'Backspace') {
    if ($from.parentOffset < 1) return null;
    const width = /[\udc00-\udfff]/.test(text[$from.parentOffset - 1] ?? '') && $from.parentOffset > 1 ? 2 : 1;
    return state.tr.delete($from.pos - width, $from.pos);
  }
  if ($from.parentOffset >= $from.parent.content.size) return null;
  const width = /[\ud800-\udbff]/.test(text[$from.parentOffset] ?? '') ? 2 : 1;
  return state.tr.delete($from.pos, $from.pos + width);
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
        // A toggled mark with nothing typed yet (storedMarks) changes what the toolbar shows too.
        if (!previous.selection.eq(_view.state.selection) || !previous.doc.eq(_view.state.doc) || previous.storedMarks !== _view.state.storedMarks) caret();
      },
    }),
  });

  const commands = regionCommands(kind);
  const linkRequest: Command = (state) => { post({ kind: 'region-link', regionId, href: linkAt(state) }); return true; };
  const base = editorState(kind, regionText(doc));
  view = new EditorView({ mount: root }, { state: base.reconfigure({ plugins: [...base.plugins, shortcuts(kind, commands, linkRequest), frame] }) });
  painter = createRegionCaretPainter(view, regionId);

  if (options.at !== undefined) {
    let place: { pos: number } | null = null;
    if (options.at) try { place = view.posAtCoords({ left: options.at.x, top: options.at.y }); } catch { /* no layout */ }
    if (place) view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(place.pos))));
    if (options.focus !== false) view.focus();
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
      const command = commandOf(commands, name, args);
      if (!command || destroyed) return false;
      const done = command(view.state, view.dispatch, view);
      view.focus();
      return done;
    },
    replay(entries) {
      for (const entry of entries) {
        if (destroyed) return;
        if ('text' in entry) {
          // Typed text goes in a character at a time, as it was typed (input rules see each); an IME's commit whole.
          for (const text of entry.composed ? [entry.text] : Array.from(entry.text)) {
            const { from, to } = view.state.selection;
            const insert = () => view.state.tr.insertText(text, from, to);
            if (!view.someProp('handleTextInput', (handle) => handle(view, from, to, text, insert))) view.dispatch(insert());
          }
          continue;
        }
        const event = new (win as unknown as { KeyboardEvent: typeof KeyboardEvent }).KeyboardEvent('keydown', { ...entry, bubbles: true, cancelable: true });
        if (view.someProp('handleKeyDown', (handle) => handle(view, event))) continue;
        const tr = defaultKey(view.state, entry.key);
        if (tr) view.dispatch(tr.scrollIntoView());
      }
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
