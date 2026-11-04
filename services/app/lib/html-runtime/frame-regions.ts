/**
 * THE FRAME'S HALF OF LIVE REGION EDITING (contracts region-sessions), in the page reader (browser-reader).
 *
 * Small on purpose: everyone who reads a framed page carries this, and nothing else of the editor. The parent says
 * which regions this viewer may edit (`regions-enabled`, only ever sent to people with edit access); pressing or
 * focusing one asks for it (`region-open`); the parent opens the session with the server and sends `region-session`,
 * and only then is the editor module (`@afbin/regions`, ./region-editor) fetched and mounted on the region's own
 * element. Messages for a region whose editor is still loading wait for it, in order. `region-closed` unmounts it and
 * puts back the region's SAVED HTML from the newest version this document drew (./live-morph keeps that source), so a
 * reader sees exactly what readers see.
 *
 * While an editor is mounted its root is handed to the live morph (`editing()`): a saved version leaves that region to
 * the editor (its text arrives through the session) instead of redrawing or rebuilding the frame.
 */
import type { RegionFrameMessage, RegionParentMessage } from '@artifactbin/contracts';
import { LOADED_SOURCE_KEY } from './live-morph-contract';
import type { RegionCaretPaint } from '../html-bridge/region-carets';
import type { RegionEditor, RegionEditorOptions } from './region-editor';

interface RegionEditorModule { mountRegionEditor(options: RegionEditorOptions): RegionEditor }
export interface FrameRegionsOptions {
  win: Window;
  /** The bridge's post (the door adds the session key); region messages only. */
  post: (message: RegionFrameMessage | { kind: 'error'; message: string }) => void;
  /** Fetches the editor module (`@afbin/regions` in a page; the module itself in tests). */
  load: () => Promise<RegionEditorModule>;
}
export interface FrameRegions {
  /** Takes a parent payload; true when it was a region message. */
  receive(payload: { kind: string }): boolean;
  /** Region id → its mounted editor's root: the live morph leaves these to their editors. */
  editing(): ReadonlyMap<string, Element>;
  /** The editors' caret overlays, which page observers ignore. */
  ownsOverlay(node: Node): boolean;
  dispose(): void;
}

const REGION_KINDS: readonly string[] = ['rich', 'text'];
const ID = /^[A-Za-z][A-Za-z0-9_-]{0,127}$/;
const isRegionMessage = (payload: { kind: string }): payload is RegionParentMessage => payload.kind === 'regions-enabled' || payload.kind.startsWith('region-');

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

export function startFrameRegions({ win, post, load }: FrameRegionsOptions): FrameRegions {
  const doc = win.document;
  let enabled = new Set<string>();
  /** Regions asked for (`region-open`) and not yet answered or closed, with where the person pressed. */
  const asked = new Map<string, { x: number; y: number } | null>();
  const sessions = new Map<string, Session>();
  /** Tab stops this module added to enabled regions (removed again when they are no longer enabled). */
  const focusable = new Set<HTMLElement>();
  let carets: readonly RegionCaretPaint[] = [];
  let module: Promise<RegionEditorModule> | null = null;
  let disposed = false;

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
  const ask = (id: string, at: { x: number; y: number } | null) => {
    if (sessions.has(id) || asked.has(id)) return;
    asked.set(id, at);
    post({ kind: 'region-open', regionId: id });
  };
  // A press on a link follows it (frame-links): it does not open the region under a page that is being left.
  const onPress = (event: PointerEvent) => { const id = regionOf(event.target); if (id && !(event.target as Element).closest('a[href]')) ask(id, { x: event.clientX, y: event.clientY }); };
  const onFocus = (event: FocusEvent) => { const id = regionOf(event.target); if (id) ask(id, null); };
  doc.addEventListener('pointerdown', onPress, true);
  doc.addEventListener('focusin', onFocus, true);

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
    const session = sessions.get(id);
    if (!session) return;
    sessions.delete(id);
    if (session.editor) { session.editor.destroy(); restore(id, session); }
  };

  const mount = (id: string, session: Session, editors: RegionEditorModule) => {
    if (disposed || sessions.get(id) !== session) return;
    const { start } = session;
    session.shown = [...session.root.childNodes];
    session.editor = editors.mountRegionEditor({ win, root: session.root, regionId: id, kind: start.regionKind, clientId: start.clientId, state: start.state, post, at: asked.has(id) ? asked.get(id) ?? null : undefined });
    asked.delete(id);
    session.editor.paint(carets);
    for (const message of session.queue.splice(0)) deliver(session.editor, message);
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
    const session: Session = { root, editor: null, start: message, queue: [], shown: [] };
    sessions.set(id, session);
    module ??= load().catch((error: unknown) => { module = null; throw error; });
    module.then((editors) => mount(id, session, editors), (error: unknown) => {
      if (sessions.get(id) === session) sessions.delete(id);
      asked.delete(id);
      post({ kind: 'error', message: `the region editor could not load: ${String(error)}`.slice(0, 500) });
    });
  };

  const receive = (message: RegionParentMessage) => {
    switch (message.kind) {
      case 'regions-enabled': {
        enabled = new Set((Array.isArray(message.regionIds) ? message.regionIds : []).filter((id) => typeof id === 'string' && ID.test(id) && regionRoot(id)));
        for (const root of focusable) if (!enabled.has(root.getAttribute('data-af-id') ?? '')) { root.removeAttribute('tabindex'); focusable.delete(root); }
        for (const id of enabled) { const root = regionRoot(id)!; if (!root.hasAttribute('tabindex')) { root.setAttribute('tabindex', '0'); focusable.add(root); } }
        return;
      }
      case 'region-session': open(message); return;
      case 'region-remote': case 'region-command': {
        const session = sessions.get(message.regionId);
        if (message.kind === 'region-remote' && (!Array.isArray(message.updates) || !message.updates.every((update) => update instanceof Uint8Array))) return;
        if (session?.editor) deliver(session.editor, message);
        else session?.queue.push(message);
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
    ownsOverlay(node) {
      for (const session of sessions.values()) if (session.editor?.owns(node)) return true;
      return false;
    },
    dispose() {
      if (disposed) return;
      for (const id of [...sessions.keys()]) close(id);
      disposed = true;
      doc.removeEventListener('pointerdown', onPress, true);
      doc.removeEventListener('focusin', onFocus, true);
      for (const root of focusable) root.removeAttribute('tabindex');
      focusable.clear();
    },
  };
}
