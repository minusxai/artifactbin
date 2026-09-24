/**
 * WHAT A RESOLVED COMMENT WAS ABOUT. Selecting a resolved thread used to expand
 * its card and nothing else: no highlight, no scroll, and for a thread whose
 * passage had been deleted only "annotated element was removed". The document
 * shows the passage when it can; the card shows the original quote when it cannot.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { STORY_ANNOTATIONS_MESSAGE, STORY_ANNOTATION_PIN_MESSAGE, STORY_ANNOTATION_LAYOUT_MESSAGE } from '@/lib/story-runtime/contract';
import { ANN, NONCE, RESOLVED, flush, fromFrame, installAnnotationFetch, layer, makeFrame } from '@/test/helpers/annotation-layer';

beforeEach(installAnnotationFetch);
afterEach(() => {vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals();});

/** Serve this row as the resolved history; everything else keeps the shared stub. */
function serveResolved(row: typeof RESOLVED) {
  const base = globalThis.fetch;
  vi.stubGlobal('fetch', (async (url: RequestInfo | URL, init?: RequestInit) =>
    String(url).includes('status=resolved')
      ? new Response(JSON.stringify({ annotations: [row] }), { status: 200 })
      : base(url, init)) as typeof fetch);
}
const posts = (postMessage: ReturnType<typeof vi.fn>) =>
  postMessage.mock.calls.map((c) => c[0]).filter((m) => m?.type === STORY_ANNOTATIONS_MESSAGE);

describe('selecting a resolved thread', () => {
  it('highlights its passage: the same post names it open and carries its pin', async () => {
    const { frame, postMessage } = makeFrame();
    render(layer(frame, { railOpen: true }));
    await flush(); await flush();
    expect(posts(postMessage).at(-1).pins.map((p: { id: string }) => p.id)).toEqual(['ann_1']);

    fireEvent.click(await screen.findByLabelText('Show resolved conversation'));
    await flush();
    const last = posts(postMessage).at(-1);
    expect(last.openId).toBe(RESOLVED.id);
    expect(last.pins.map((p: { id: string }) => p.id)).toEqual(['ann_1', RESOLVED.id]);
    expect(last.pins.find((p: { id: string }) => p.id === RESOLVED.id)).toMatchObject({ path: RESOLVED.anchor!.path });
    // Never an open id without its pin: the frame records the scroll as done and cannot repeat it.
    for (const m of posts(postMessage)) if (m.openId) expect(m.pins.some((p: { id: string }) => p.id === m.openId)).toBe(true);
  });

  it('paints nothing resolved at rest, and stops when the thread is collapsed', async () => {
    const { frame, postMessage } = makeFrame();
    render(layer(frame, { railOpen: true }));
    await flush(); await flush();
    fireEvent.click(await screen.findByLabelText('Show resolved conversation'));
    await flush();
    fireEvent.click(screen.getByLabelText('Hide resolved conversation'));
    await flush();
    expect(posts(postMessage).at(-1)).toMatchObject({ openId: null, pins: [{ id: 'ann_1' }] });
    expect(posts(postMessage).at(-1).pins).toHaveLength(1);
  });

  it('shows the original quote when the passage was removed from the document', async () => {
    serveResolved({ ...RESOLVED, anchor: null, orphaned: true, quote: 'Size: about a day.', quote_found: false });
    const { frame, postMessage } = makeFrame();
    render(layer(frame, { railOpen: true }));
    await flush(); await flush();
    fireEvent.click(await screen.findByLabelText('Show resolved conversation'));
    await flush();
    expect(screen.getByText('Size: about a day.')).toBeTruthy();
    expect(screen.getByText(/removed from the document/i)).toBeTruthy();
    expect(posts(postMessage).at(-1).pins.map((p: { id: string }) => p.id)).toEqual(['ann_1']);
  });

  it('shows the original quote when the quoted words were edited away, and still points at the block', async () => {
    serveResolved({ ...RESOLVED, quote: 'an older figure of 40%', quote_found: false });
    const { frame, postMessage } = makeFrame();
    render(layer(frame, { railOpen: true }));
    await flush(); await flush();
    fireEvent.click(await screen.findByLabelText('Show resolved conversation'));
    await flush();
    expect(screen.getByText('an older figure of 40%')).toBeTruthy();
    expect(screen.getByText(/since been edited/i)).toBeTruthy();
    expect(posts(postMessage).at(-1).pins.map((p: { id: string }) => p.id)).toContain(RESOLVED.id);
  });

  it('does not repeat a passage the document is already showing', async () => {
    serveResolved({ ...RESOLVED, quote: 'an older figure', quote_found: true });
    const { frame } = makeFrame();
    render(layer(frame, { railOpen: true }));
    await flush(); await flush();
    fireEvent.click(await screen.findByLabelText('Show resolved conversation'));
    await flush();
    expect(screen.queryByText('an older figure')).toBeNull();
  });
  /**
   * Expanding a resolved thread is a choice the reader makes. A thread that was open and is
   * resolved by someone else remains visible until the reader closes it.
   */
  it('keeps an open thread visible when resolved from elsewhere', async () => {
    const { frame, postMessage, contentWindow } = makeFrame();
    const view = render(layer(frame, { railOpen: true }));
    await flush(); await flush();
    fromFrame(contentWindow, { type: STORY_ANNOTATION_PIN_MESSAGE, nonce: NONCE, id: ANN.id });
    await flush();
    expect(posts(postMessage).at(-1)).toMatchObject({ openId: ANN.id });

    serveResolved({ ...ANN, status: 'resolved', resolved_at: '2026-08-28T00:00:00Z' });
    view.rerender(layer(frame, { railOpen: true, liveAnnotations: [] }));
    await flush(); await flush();
    expect(posts(postMessage).at(-1)).toMatchObject({ openId: ANN.id, pins: [{id:ANN.id}] });
  });
});

it('counts only visible unpaused seconds and expires without acknowledging the notification',async()=>{
 vi.useFakeTimers({toFake:['setInterval','clearInterval','performance']});
 const visibility=vi.spyOn(document,'visibilityState','get').mockReturnValue('visible');
 const {frame,contentWindow,postMessage}=makeFrame();
 const view=render(layer(frame,{showViewComments:true}));await flush();await flush();
 const position=(y:number)=>fromFrame(contentWindow,{type:STORY_ANNOTATION_LAYOUT_MESSAGE,nonce:NONCE,positions:[{id:ANN.id,rect:{x:10,y,width:300,height:40}}]});
 position(220);
 serveResolved({...ANN,status:'resolved',revision:2,resolved_at:'2026-09-23T00:00:00Z'});
 view.rerender(layer(frame,{showViewComments:true,liveAnnotations:[]}));await flush();await flush();
 const remaining=()=>screen.queryByRole('status')?.textContent;
 expect(remaining()).toContain('10 seconds');
 expect(posts(postMessage).at(-1).pins.map((p:{id:string})=>p.id)).toContain(ANN.id);
 visibility.mockReturnValue('hidden');act(()=>vi.advanceTimersByTime(12000));expect(remaining()).toContain('10 seconds');
 visibility.mockReturnValue('visible');position(900);act(()=>vi.advanceTimersByTime(12000));
 position(220);expect(remaining()).toContain('10 seconds');
 const marker=screen.getByLabelText(/Open annotation conversation/);
 fireEvent.focus(marker);act(()=>vi.advanceTimersByTime(12000));expect(remaining()).toContain('10 seconds');
 fireEvent.blur(marker);act(()=>vi.advanceTimersByTime(4000));expect(remaining()).toContain('6 seconds');
 const card=marker.closest('[data-annotation-id]')!;
 expect(card.querySelector('circle')).not.toBeNull();
 const ringAnchor=card.querySelector('svg')!.parentElement!;
 expect(ringAnchor.textContent).toBe('V'); // ring shares the avatar's box, excluding the reply count
 fireEvent.mouseEnter(card);act(()=>vi.advanceTimersByTime(12000));expect(remaining()).toContain('6 seconds');
 expect(card.querySelector('circle')).toBeNull(); // paused countdown must not stretch over the preview
 fireEvent.mouseLeave(card);
 expect(card.querySelector('circle')).not.toBeNull();
 act(()=>vi.advanceTimersByTime(6100));
 expect(screen.queryByLabelText(/Open annotation conversation/)).toBeNull();
});
it('restarts a resolved indicator only for a new revision and cancels it on reopening',async()=>{
 vi.useFakeTimers({toFake:['setInterval','clearInterval','performance']});
 vi.spyOn(document,'visibilityState','get').mockReturnValue('visible');
 const {frame,contentWindow}=makeFrame();const view=render(layer(frame,{showViewComments:true}));await flush();await flush();
 fromFrame(contentWindow,{type:STORY_ANNOTATION_LAYOUT_MESSAGE,nonce:NONCE,positions:[{id:ANN.id,rect:{x:10,y:220,width:300,height:40}}]});
 serveResolved({...ANN,status:'resolved',revision:2});view.rerender(layer(frame,{showViewComments:true,liveAnnotations:[]}));await flush();await flush();
 act(()=>vi.advanceTimersByTime(4000));expect(screen.getByRole('status')).toHaveTextContent('6 seconds');
 view.rerender(layer(frame,{showViewComments:true,liveAnnotations:[]}));await flush();await flush();expect(screen.getByRole('status')).toHaveTextContent('6 seconds');
 serveResolved({...ANN,status:'resolved',revision:3});view.rerender(layer(frame,{showViewComments:true,liveAnnotations:[]}));await flush();await flush();expect(screen.getByRole('status')).toHaveTextContent('10 seconds');
 view.rerender(layer(frame,{showViewComments:true,liveAnnotations:[{...ANN,revision:4}]}));await flush();await flush();expect(screen.queryByRole('status')).toBeNull();
 act(()=>vi.advanceTimersByTime(12000));expect(screen.getByLabelText(/Open annotation conversation/)).toBeVisible();
});

it('opens a notification target when navigation changes the query on the same artefact',async()=>{
 const {frame,postMessage}=makeFrame();const open=vi.fn();
 const view=render(layer(frame,{onRailOpenChange:open}));await flush();await flush();
 try{
  window.history.replaceState(null,'',`?thread=${ANN.id}`);
  view.rerender(layer(frame,{onRailOpenChange:open}));await flush();
  expect(open).toHaveBeenCalledWith(true);
  expect(posts(postMessage).at(-1).openId).toBe(ANN.id);
 }finally{window.history.replaceState(null,'',window.location.pathname);}
});
