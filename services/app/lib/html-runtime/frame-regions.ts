/**
 * THE FRAME'S HALF OF LIVE REGION EDITING (contracts region-sessions), in the page reader (browser-reader).
 *
 * Small on purpose: everyone who reads a framed page carries this, and nothing else of the editor. The parent says
 * which regions this viewer may edit (`regions-enabled`, only ever sent to people with edit access); pressing or
 * focusing one asks for it (`region-open`); the parent opens the session with the server and sends `region-session`,
 * and only then is the editor module (`@afbin/native-regions`, ./native-region-editor) fetched and mounted on the region's own
 * element. Messages for a region whose editor is still loading wait for it, in order. `region-closed` unmounts it and
 * puts back the region's SAVED HTML from the newest version this document drew (./live-morph keeps that source), so a
 * reader sees exactly what readers see.
 *
 * While an editor is mounted its root is handed to the live morph (`editing()`): a saved version leaves that region to
 * the editor (its text arrives through the session) instead of redrawing or rebuilding the frame.
 *
 * NO KEY IS LOST BETWEEN THE PRESS AND THE EDITOR. Asking for a region puts the focus in an invisible text input at the press (`data-af="region-keys"`, outside the page's body, so neither the live
 * morph nor page observers see it). What is typed there — characters, an IME's committed text, Enter, Backspace,
 * Delete, Tab and Mod-B/I/E — is kept in order and replayed into the editor when it mounts (RegionEditor.replay). A
 * composition still open then is let finish first: the editor mounts on its compositionend, so nothing is lost or
 * typed twice. A doc opened without a press (the parent's auto-open asks its editor for the `focus` command before
 * the editor mounts) holds its keys the same way, from that command on.
 */
import type { RegionFrameMessage, RegionParentMessage } from '@artifactbin/contracts';
import { LOADED_SOURCE_KEY } from './live-morph-contract';
import type { RegionCaretPaint } from '../html-bridge/region-carets';
import type { RegionEditor, RegionEditorOptions, RegionKeyEntry } from './region-editor-contract';

interface RegionEditorModule { mountRegionEditor(options: RegionEditorOptions): RegionEditor }
export interface FrameRegionsOptions {
  win: Window;
  /** The bridge's post (the door adds the session key); region messages only. */
  post: (message: RegionFrameMessage | { kind: 'error'; message: string }) => void;
  /** Fetches the editor module (`@afbin/regions` in a page; the module itself in tests). */
  load: (kind?: string) => Promise<RegionEditorModule>;
  /** The page's id: the caret kept across a rebuild (`keepForRebuild`) is this page's alone. */
  pageId?: string;
}
export interface FrameRegions {
  /** Takes a parent payload; true when it was a region message. */
  receive(payload: { kind: string }): boolean;
  /** Region id → its mounted editor's root: the live morph leaves these to their editors. */
  editing(): ReadonlyMap<string, Element>;
  /** The editors' caret overlays, which page observers ignore. */
  ownsOverlay(node: Node): boolean;
  /**
   * This document is about to be replaced by a rebuild (a version not drawn in place, live-morph): the focused editor's
   * caret is kept, briefly, for the next document, which opens that region again with the caret and the focus there.
   */
  keepForRebuild(): void;
  dispose(): void;
}

/** How long a kept caret waits for the rebuilt document (a rebuild is one navigation of this frame). */
const KEPT_CARET_MS = 15_000;
interface KeptCaret { regionId: string; anchor: string; head: string; at: number }
const keptKey = (pageId: string) => `afbin:region-caret:${pageId}`;
function takeKeptCaret(win: Window, pageId: string | undefined, now: number): KeptCaret | null {
  if (!pageId) return null;
  try {
    const raw = win.sessionStorage.getItem(keptKey(pageId));
    if (raw === null) return null;
    win.sessionStorage.removeItem(keptKey(pageId));
    const kept = JSON.parse(raw) as Partial<KeptCaret>;
    const fresh = typeof kept.at === 'number' && now >= kept.at && now - kept.at <= KEPT_CARET_MS;
    return fresh && typeof kept.regionId === 'string' && typeof kept.anchor === 'string' && typeof kept.head === 'string' ? kept as KeptCaret : null;
  } catch { return null; }
}

const REGION_KINDS: readonly string[] = ['rich', 'text', 'rich-native-v1'];
const ID = /^[A-Za-z][A-Za-z0-9_-]{0,127}$/;
const isRegionMessage = (payload: { kind: string }): payload is RegionParentMessage => payload.kind === 'regions-enabled' || payload.kind.startsWith('region-');
/** The most keys held for one region before its editor mounts. */
const MAX_HELD_KEYS = 4000;
/** Keys the editor acts on, held (and kept from the input) as keys rather than text. */
const EDITING_KEYS = new Set(['Enter', 'Backspace', 'Delete', 'Tab']);
const MOD_KEYS = new Set(['b', 'i', 'e']);

/** Keys typed for a region whose editor is not mounted yet. */
interface Held {
  input: HTMLTextAreaElement;
  entries: RegionKeyEntry[];
  composing: boolean;
  /** The editor is ready but a composition is open: it mounts on compositionend. */
  then: (() => void) | null;
  stop(): void;
}

type Pending = Extract<RegionParentMessage, { kind: 'region-remote' | 'region-command' }>;
interface Session {
  root: HTMLElement;
  editor: RegionEditor | null;
  /** While the module loads: the newest session and what arrived for it since, in order. */
  start: Extract<RegionParentMessage, { kind: 'region-session' }>;
  queue: Pending[];
  /** The children the region showed when the editor took it (restored if no saved source is kept). */
  shown: Node[];
}

export function startFrameRegions({ win, post, load, pageId }: FrameRegionsOptions): FrameRegions {
  const doc = win.document;
  /** The caret the document this one replaced kept for it (a rebuild), until its region's editor mounts. */
  let kept = takeKeptCaret(win, pageId, Date.now());
  let enabled = new Set<string>();
  /** Regions asked for (`region-open`) and not yet answered or closed, with where the person pressed. */
  const asked = new Map<string, { x: number; y: number } | null>();
  const sessions = new Map<string, Session>();
  /** Tab stops this module added to enabled regions (removed again when they are no longer enabled). */
  const focusable = new Set<HTMLElement>();
  let carets: readonly RegionCaretPaint[] = [];

  let disposed = false;
  /** A `focus` command for a region whose session has not arrived yet. */
  const early = new Map<string, Pending>();
  /** Keys typed for each region asked for, until its editor mounts. */
  const held = new Map<string, Held>();
  /** The editor module: fetched for the first session, never for a reader (who is never sent one). */
  const loadEditor = load;

  /** The region element with this id, or null: exactly one element, declaring a known kind. */
  const regionRoot = (id: string): HTMLElement | null => {
    const found = [...doc.querySelectorAll('[data-af-editable]')].filter((element) => element.getAttribute('data-af-id') === id);
    const root = found.length === 1 ? found[0] as HTMLElement : null;
    return root && REGION_KINDS.includes(root.getAttribute('data-af-editable') ?? '') ? root : null;
  };
  const regionOf = (target: EventTarget | null): string | null => {
    const element = target && typeof (target as Element).closest === 'function' ? (target as Element).closest('[data-af-editable]') : null;
    const id = element?.getAttribute('data-af-id');
    return id && enabled.has(id) && regionRoot(id) === element ? id : null;
  };
  /** From the press to the editor: the keys go to an invisible input at the press, and are kept in order. */
  const hold = (id: string, at: { x: number; y: number } | null) => {
    const root = regionRoot(id);
    if (!root || held.has(id)) return;
    const input = doc.createElement('textarea');
    const box = at ?? (() => { const rect = root.getBoundingClientRect(); return { x: rect.left, y: rect.top }; })();
    input.setAttribute('data-af', 'region-keys');
    input.setAttribute('aria-label', 'Region editor, opening');
    for (const [name, value] of [['autocomplete', 'off'], ['autocapitalize', 'off'], ['spellcheck', 'false']]) input.setAttribute(name, value!);
    input.style.cssText = `position:fixed;left:${Math.round(box.x)}px;top:${Math.round(box.y)}px;width:2px;height:1.2em;margin:0;padding:0;border:0;outline:0;opacity:0;resize:none;overflow:hidden;font-size:16px;caret-color:transparent;pointer-events:none;z-index:2147483647`;
    const entry: Held = { input, entries: [], composing: false, then: null, stop: () => {} };
    const keep = (next: RegionKeyEntry) => { if (entry.entries.length < MAX_HELD_KEYS) entry.entries.push(next); };
    /** What the input holds is typed text not yet kept: kept now, in order before the next key. */
    const take = (composed?: true) => { if (input.value) { keep(composed ? { text: input.value, composed } : { text: input.value }); input.value = ''; } };
    const onKey = (event: KeyboardEvent) => {
      if (event.isComposing || entry.composing || event.keyCode === 229) return;
      const mod = event.ctrlKey || event.metaKey;
      if (!(EDITING_KEYS.has(event.key) && !mod && !event.altKey) && !(mod && !event.altKey && MOD_KEYS.has(event.key.toLowerCase()))) return;
      event.preventDefault();
      take();
      const { key, code, keyCode, shiftKey, altKey, ctrlKey, metaKey } = event;
      keep({ key, code, keyCode, shiftKey, altKey, ctrlKey, metaKey });
    };
    // A keyboard that says nothing on keydown (Android) still says what it does here.
    const onBeforeInput = (event: InputEvent) => {
      if (entry.composing || event.isComposing) return;
      const key = event.inputType === 'insertLineBreak' || event.inputType === 'insertParagraph' ? 'Enter' : event.inputType === 'deleteContentBackward' && !input.value ? 'Backspace' : null;
      if (!key) return;
      event.preventDefault();
      take();
      keep({ key });
    };
    const onInput = (event: Event) => { if (!entry.composing && !(event as InputEvent).isComposing) take(); };
    const onStart = () => { take(); entry.composing = true; };
    const onEnd = () => { entry.composing = false; take(true); const then = entry.then; entry.then = null; then?.(); };
    const listeners: Array<[string, EventListener]> = [['keydown', onKey as EventListener], ['beforeinput', onBeforeInput as EventListener], ['input', onInput], ['compositionstart', onStart], ['compositionend', onEnd]];
    for (const [type, listener] of listeners) input.addEventListener(type, listener);
    entry.stop = () => { for (const [type, listener] of listeners) input.removeEventListener(type, listener); input.remove(); };
    held.set(id, entry);
    doc.documentElement.append(input);
    input.focus({ preventScroll: true });
  };
  const release = (id: string) => { const entry = held.get(id); if (entry) { held.delete(id); entry.stop(); } };
  const ask = (id: string, at: { x: number; y: number } | null) => {
    if (sessions.has(id) || asked.has(id)) return;
    asked.set(id, at);
    post({ kind: 'region-open', regionId: id });
    hold(id, at);
  };
  // A press on a link follows it (frame-links): it does not open the region under a page that is being left.
  const onPress = (event: PointerEvent) => { const id = regionOf(event.target); if (id && !(event.target as Element).closest('a[href]')) ask(id, { x: event.clientX, y: event.clientY }); };
  // The press focuses the region after pointerdown: while its editor loads, the focus belongs to the keys' input.
  const onFocus = (event: FocusEvent) => { const id = regionOf(event.target); if (!id) return; ask(id, null); held.get(id)?.input.focus({ preventScroll: true }); };
  doc.addEventListener('pointerdown', onPress, true);
  doc.addEventListener('focusin', onFocus, true);
  /** The region whose editor had the focus last. */
  let lastEditing: string | null = null;
  const onEditorFocus = (event: FocusEvent) => { for (const [id, session] of sessions) if (session.root.contains(event.target as Node)) lastEditing = id; };
  doc.addEventListener('focusin', onEditorFocus);
  // The page hands the focus back (after its toolbar, slash menu or link dialog): the frame gets it at its body, and the
  // editor's command arrives a message later. The editor that had it takes it at once, so no key typed between is lost.
  const onWindowFocus = () => {
    const editor = lastEditing ? sessions.get(lastEditing)?.editor : null;
    if (editor && (!doc.activeElement || doc.activeElement === doc.body)) editor.view.focus();
  };
  win.addEventListener('focus', onWindowFocus);

  /** Puts the saved HTML back: the region as the newest drawn version has it, else as it was when the editor took it. */
  const restore = (id: string, session: Session) => {
    const { root } = session;
    const loaded = (win as unknown as Record<symbol, unknown>)[Symbol.for(LOADED_SOURCE_KEY)];
    if (typeof loaded === 'string') {
      const saved = [...new (win as unknown as { DOMParser: typeof DOMParser }).DOMParser().parseFromString(loaded, 'text/html').querySelectorAll('[data-af-editable]')].find((element) => element.getAttribute('data-af-id') === id);
      if (saved) { root.replaceChildren(...[...saved.childNodes].map((node) => doc.importNode(node, true))); return; }
    }
    root.replaceChildren(...session.shown);
  };
  const close = (id: string) => {
    asked.delete(id);
    early.delete(id);
    release(id);
    const session = sessions.get(id);
    if (!session) return;
    sessions.delete(id);
    if (session.editor) { session.editor.destroy(); restore(id, session); }
  };

  const mount = (id: string, session: Session, editors: RegionEditorModule) => {
    if (disposed || sessions.get(id) !== session) return;
    const keys = held.get(id);
    if (keys?.composing) { keys.then = () => mount(id, session, editors); return; }
    const { start } = session;
    session.shown = [...session.root.childNodes];
    // The caret goes where they pressed; the focus too, unless they moved on while the editor loaded. The keys' input
    // goes first: the editor's focus must not be sent back to it.
    const focus = !keys || doc.activeElement === keys.input;
    release(id);
    const carried = kept?.regionId === id ? { anchor: kept.anchor, head: kept.head } : undefined;
    if (carried) kept = null;
    session.editor = editors.mountRegionEditor({ win, root: session.root, regionId: id, kind: start.regionKind, clientId: start.clientId, state: start.state, post, at: asked.has(id) ? asked.get(id) ?? null : undefined, ...(focus ? {} : { focus: false as const }), ...(carried && focus ? { caret: carried } : {}) });
    asked.delete(id);
    session.editor.paint(carets);
    for (const message of session.queue.splice(0)) deliver(session.editor, message);
    if (keys) session.editor.replay(keys.entries);
  };
  const deliver = (editor: RegionEditor, message: Pending) => {
    if (message.kind === 'region-remote') editor.remote(message.updates);
    else editor.command(message.name, message.args);
  };

  const open = (message: Extract<RegionParentMessage, { kind: 'region-session' }>) => {
    const { regionId: id } = message;
    const root = regionRoot(id);
    if (!root || root.getAttribute('data-af-editable') !== message.regionKind || !Number.isInteger(message.clientId) || !(message.state instanceof Uint8Array)) return;
    const current = sessions.get(id);
    if (current?.root === root) {
      if (current.editor) current.editor.session(message.clientId, message.state);
      // Still loading: the newest state wins, and remote updates already queued are in it or after it (Yjs merges both).
      else current.start = message;
      return;
    }
    if (current) close(id);
    const session: Session = { root, editor: null, start: message, queue: early.has(id) ? [early.get(id)!] : [], shown: [] };
    early.delete(id);
    sessions.set(id, session);
    loadEditor(message.regionKind).then((editors) => mount(id, session, editors), (error: unknown) => {
      if (sessions.get(id) === session) sessions.delete(id);
      asked.delete(id);
      release(id);
      post({ kind: 'error', message: String(error).slice(0, 500) });
    });
  };

  const receive = (message: RegionParentMessage) => {
    switch (message.kind) {
      case 'regions-enabled': {
        enabled = new Set((Array.isArray(message.regionIds) ? message.regionIds : []).filter((id) => typeof id === 'string' && ID.test(id) && regionRoot(id)));
        for (const root of focusable) if (!enabled.has(root.getAttribute('data-af-id') ?? '')) { root.removeAttribute('tabindex'); focusable.delete(root); }
        for (const id of enabled) { const root = regionRoot(id)!; if (!root.hasAttribute('tabindex')) { root.setAttribute('tabindex', '0'); focusable.add(root); } }
        // Rebuilt under an editor: its region opens again as if pressed, keys typed meanwhile held for it.
        if (kept && enabled.has(kept.regionId)) ask(kept.regionId, null);
        return;
      }
      case 'region-session': open(message); return;
      case 'region-remote': case 'region-command': {
        const session = sessions.get(message.regionId);
        if (message.kind === 'region-remote' && (!Array.isArray(message.updates) || !message.updates.every((update) => update instanceof Uint8Array))) return;
        const focus = message.kind === 'region-command' && message.name === 'focus';
        if (session?.editor) deliver(session.editor, message);
        else if (session) session.queue.push(message);
        // A doc opening with no press asks for the focus before its session: it waits for the session with it.
        else if (focus && enabled.has(message.regionId)) early.set(message.regionId, message as Pending);
        // The editor will take the focus when it mounts: until then the keys are held for it, as after a press.
        if (focus && !session?.editor && enabled.has(message.regionId)) hold(message.regionId, null);
        return;
      }
      // The parent tracks acknowledgements and resends; the editor needs none (a resend is a duplicate Yjs drops).
      case 'region-ack': return;
      case 'region-closed': close(message.regionId); return;
      case 'region-paint':
        carets = Array.isArray(message.carets) ? message.carets : [];
        for (const session of sessions.values()) session.editor?.paint(carets);
        return;
      default: return;
    }
  };

  return {
    receive(payload) {
      if (!isRegionMessage(payload)) return false;
      if (!disposed) receive(payload);
      return true;
    },
    editing() {
      const roots = new Map<string, Element>();
      for (const [id, session] of sessions) if (session.editor) roots.set(id, session.root);
      return roots;
    },
    keepForRebuild() {
      if (!pageId) return;
      for (const [regionId, session] of sessions) {
        const caret = session.editor?.caret();
        if (!caret) continue;
        try { win.sessionStorage.setItem(keptKey(pageId), JSON.stringify({ regionId, ...caret, at: Date.now() } satisfies KeptCaret)); } catch { /* the rebuild still happens */ }
        return;
      }
    },
    ownsOverlay(node) {
      for (const session of sessions.values()) if (session.editor?.owns(node)) return true;
      for (const keys of held.values()) if (keys.input === node || keys.input.contains(node)) return true;
      return false;
    },
    dispose() {
      if (disposed) return;
      for (const id of [...sessions.keys()]) close(id);
      for (const id of [...held.keys()]) release(id);
      disposed = true;
      doc.removeEventListener('pointerdown', onPress, true);
      doc.removeEventListener('focusin', onFocus, true);
      doc.removeEventListener('focusin', onEditorFocus);
      win.removeEventListener('focus', onWindowFocus);
      for (const root of focusable) root.removeAttribute('tabindex');
      focusable.clear();
    },
  };
}
