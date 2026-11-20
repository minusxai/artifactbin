/**
 * THE COMMENT LAYER'S LINE TO THE DOCUMENT RUNTIME.
 *
 * `connectFrameAnnotations` re-posts the whole pin set (`mx:annotations`) on every change — the runtime holds no
 * annotation state it could get out of step on — and turns the runtime's signed answers into calls: a Select pressed
 * in the document, a pin clicked or hovered, a selection reported. It keeps what the runtime last said about where
 * each pin sits. Both directions wait for the session nonce: its announcement means the runtime's listener exists.
 * Unmounting turns the runtime's annotations off.
 *
 * Interface: `connectFrameAnnotations({ runtimeRef, nonce, state, on })` → `{ requestViewState, viewStateError,
 * missing, anchorRects }`.
 */
import { batch, createEffect, createSignal, onCleanup } from 'solid-js';
import type { AnnotationWire } from '@/lib/annotations';
import { sendDocument, subscribeDocument, type DocumentRuntimeRef } from '@/lib/html-reader';
import { isEditFrameMessage, type StoryAnnotationsMessage, type StoryEditRect, type StoryEditSelection } from '@/lib/html-runtime/bridge/selection-contract';

/** What the layer shows right now, read inside the posting effect (so each read is a dependency). */
export interface FrameAnnotationState {
  pins: { row: AnnotationWire; layoutOnly: boolean }[];
  openId: string | null;
  hoverId: string | null;
  selected: StoryEditSelection | null;
  canComment: boolean;
  pick: 'block' | 'area' | null;
  /** A screenshot is being prepared: the document shows no annotations meanwhile. */
  capturing: boolean;
}

const pinOf = ({ row, layoutOnly }: FrameAnnotationState['pins'][number]) => {
  const anchor = row.anchor! as typeof row.anchor & { nodeId?: string | null };
  return { id: row.id, path: anchor.path ?? anchor.nodeId ?? '', key: anchor.key ?? null, nodeId: anchor.nodeId, ...('kind' in anchor && anchor.kind === 'html-node' ? { anchor } : {}), range: row.range, ...(row.view_state ? {viewState: row.view_state} : {}),
    ...(layoutOnly ? { layoutOnly: true } : {}) };
};

export function connectFrameAnnotations(options: {
  runtimeRef: () => DocumentRuntimeRef | undefined;
  nonce: () => string | null;
  state: () => FrameAnnotationState;
  on: { select: () => void; pin: (id: string) => void; hover: (id: string | null) => void; selection: (selection: StoryEditSelection | null) => void };
}) {
  const post = (message: StoryAnnotationsMessage) => { const runtimeRef = options.runtimeRef(); if (runtimeRef) sendDocument({ runtimeRef }, message); };
  const [viewStateRequest, setViewStateRequest] = createSignal(0);
  const [viewStateError, setViewStateError] = createSignal<{ id: string; message: string } | null>(null);
  const [missing, setMissing] = createSignal<Set<string>>(new Set());
  const [anchorRects, setAnchorRects] = createSignal<Record<string, StoryEditRect>>({});

  createEffect(() => {
    if (!options.nonce()) return;
    const state = options.state();
    post({
      type: 'mx:annotations', viewStateRequest: viewStateRequest(), mode: state.capturing ? 'off' : 'on', pins: state.pins.map(pinOf), openId: state.openId, hoverId: state.hoverId,
      selectedPath: state.selected?.path ?? null, selected: state.selected, canComment: state.canComment, pick: state.pick,
    } satisfies StoryAnnotationsMessage);
  });
  onCleanup(() => post({ type: 'mx:annotations', mode: 'off', pins: [], openId: null, hoverId: null } satisfies StoryAnnotationsMessage));

  // What the document says: pin clicks always; selections only while a pick or a composer is open.
  createEffect(() => {
    const nonce = options.nonce();
    const runtime = options.runtimeRef();
    if (!nonce || !runtime) return;
    const unsubscribe = subscribeDocument({ runtimeRef: runtime }, (event) => {
      const data = event.data;
      if (!isEditFrameMessage(data, nonce)) return;
      if (data.type === 'mx:selection-action' && data.action === 'select') { options.on.select(); return; }
      if (data.type === 'mx:annotation-layout') {
        setViewStateError(data.viewStateError ?? null);
        const next: Record<string, StoryEditRect> = {};
        for (const position of data.positions) next[position.id] = position.rect;
        batch(() => {
          setMissing(new Set(data.positions.filter((position) => position.status === 'missing' || position.status === 'ambiguous').map((position) => position.id)));
          setAnchorRects(next);
        });
        return;
      }
      if (data.type === 'mx:annotation-pin') { options.on.pin(data.id); return; }
      if (data.type === 'mx:annotation-hover') { options.on.hover(data.id); return; }
      if (data.type === 'mx:selection') options.on.selection(data.selection);
    });
    onCleanup(unsubscribe);
  });

  return {
    /** Ask the runtime to report each pin's view state again (a thread is being opened). */
    requestViewState: () => setViewStateRequest((value) => value + 1),
    viewStateError,
    missing,
    anchorRects,
  };
}
