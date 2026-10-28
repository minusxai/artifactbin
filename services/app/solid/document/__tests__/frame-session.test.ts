/**
 * A FRAME THAT LOST ITS SESSION COMES BACK (solid/document/create-framed-story keepFrameSession).
 *
 * The document's frame holds its own origin's session (server/pages-host, 8 h). A tab left open past it, then
 * reloading its frame (a new version, a reconnect), gets the document origin's "Not found" — a document with no
 * door, so it never says `hello` — or, behind a proxy, lands on the app's own origin, where everything the page
 * posts to the document's origin goes nowhere. The page notices either and points the frame at a freshly minted
 * first URL (a new ticket), and the document's door says hello again; it never loops.
 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { keepFrameSession } from '@/solid/document/create-framed-story';
import { STORY_FRAME_BRIDGE_MESSAGE } from '@/lib/story-runtime/contract';

const PAGES = 'https://6869.pages.test';
let win: EventTarget;
let frame: EventTarget & { contentWindow: object; src: string };
let readable: boolean;
let remint: ReturnType<typeof vi.fn<(id: string) => Promise<string | null>>>;
let stop: () => void;

const hello = () => win.dispatchEvent(new MessageEvent('message', { data: { type: STORY_FRAME_BRIDGE_MESSAGE, payload: { kind: 'hello' } }, origin: PAGES, source: frame.contentWindow as Window }));
const load = () => frame.dispatchEvent(new Event('load'));
const flush = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
  vi.useFakeTimers();
  win = new EventTarget();
  frame = Object.assign(new EventTarget(), { contentWindow: {}, src: `${PAGES}/?_pt=first` });
  readable = false;
  remint = vi.fn(async (_id: string): Promise<string | null> => `${PAGES}/?_pt=fresh${remint.mock.calls.length}`);
  stop = keepFrameSession({ win: win as Window, frame: frame as unknown as HTMLIFrameElement, origin: PAGES, id: 'doc1', remint, readable: () => readable });
});
afterEach(() => { stop(); vi.useRealTimers(); });

it('a frame whose document spoke before and comes back silent (its session expired: "Not found") gets a fresh ticket', async () => {
  hello(); load(); // the served document, alive
  await vi.advanceTimersByTimeAsync(10_000);
  expect(remint).not.toHaveBeenCalled();

  load(); // the frame reloaded (a new version) into a page with no door
  await vi.advanceTimersByTimeAsync(2_999);
  expect(remint).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  await flush();
  expect(remint).toHaveBeenCalledWith('doc1');
  expect(frame.src).toBe(`${PAGES}/?_pt=fresh1`);

  // The fresh ticket's document opens its door: nothing more to do.
  hello(); load();
  await vi.advanceTimersByTimeAsync(10_000);
  expect(remint).toHaveBeenCalledTimes(1);
});

it('a frame that lands on the app\'s own origin is sent back at once', async () => {
  hello(); load();
  readable = true; // the frame's document is the app's: a redirect took it off the document's origin
  load();
  await flush();
  expect(remint).toHaveBeenCalledTimes(1);
  expect(frame.src).toBe(`${PAGES}/?_pt=fresh1`);
});

it('a reloaded document whose hello came before its load event is left alone', async () => {
  hello(); load();
  await vi.advanceTimersByTimeAsync(60_000);
  hello(); load(); // the ordinary reload: hello first, then load
  await vi.advanceTimersByTimeAsync(10_000);
  expect(remint).not.toHaveBeenCalled();
});

it('a slow document whose hello came long before its load event (images still arriving) is left alone', async () => {
  hello(); await vi.advanceTimersByTimeAsync(10_000); load(); // the served document: hello at 0, load at 10 s
  await vi.advanceTimersByTimeAsync(10_000);
  hello(); // the frame reloads: the new document's door opens at once…
  await vi.advanceTimersByTimeAsync(10_000);
  load(); // …and its load event waits 10 s for its images
  await vi.advanceTimersByTimeAsync(10_000);
  expect(remint, 'a hello after the previous load is this document\'s').not.toHaveBeenCalled();
});

it('never loops: a document that stays unreachable is re-minted at most twice in five minutes, and a refused mint changes nothing', async () => {
  hello(); load();
  for (let i = 0; i < 5; i++) { load(); await vi.advanceTimersByTimeAsync(3_000); await flush(); }
  expect(remint).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(5 * 60_000);
  remint.mockImplementation(async (_id: string) => null); // the reader lost access: the app says so, and the frame is left as it is
  load(); await vi.advanceTimersByTimeAsync(3_000); await flush();
  expect(remint).toHaveBeenCalledTimes(3);
  expect(frame.src).toBe(`${PAGES}/?_pt=fresh2`);
});

it('a document that never spoke (no door) is never second-guessed', async () => {
  load(); load();
  await vi.advanceTimersByTimeAsync(10_000);
  expect(remint).not.toHaveBeenCalled();
});

it('another window\'s messages, or the right window on the wrong origin, are not the document speaking', async () => {
  win.dispatchEvent(new MessageEvent('message', { data: { type: STORY_FRAME_BRIDGE_MESSAGE, payload: { kind: 'hello' } }, origin: PAGES, source: {} as Window }));
  win.dispatchEvent(new MessageEvent('message', { data: { type: STORY_FRAME_BRIDGE_MESSAGE, payload: { kind: 'hello' } }, origin: 'https://evil.test', source: frame.contentWindow as Window }));
  load(); load();
  await vi.advanceTimersByTimeAsync(10_000);
  expect(remint, 'nothing proved this document speaks').not.toHaveBeenCalled();
});

it('the served document is left alone when this watchdog started after its hello but saw its ready, then a quiet load', async () => {
  // The watchdog is installed lazily: the door's hello is already gone, the bridge's attach is answered with `ready`,
  // the page's queries are relayed, and the load event (images) lands while the document waits on their replies.
  const ready = () => win.dispatchEvent(new MessageEvent('message', { data: { type: STORY_FRAME_BRIDGE_MESSAGE, key: 'k', payload: { kind: 'ready', nonce: 'n' } }, origin: PAGES, source: frame.contentWindow as Window }));
  ready();
  await vi.advanceTimersByTimeAsync(1_000);
  load();
  await vi.advanceTimersByTimeAsync(10_000);
  expect(remint, 'a document that answered ready is alive: no second navigation').not.toHaveBeenCalled();
  expect(frame.src).toBe(`${PAGES}/?_pt=first`);
  load(); // a later silent reload is still recovered
  await vi.advanceTimersByTimeAsync(3_000);
  await flush();
  expect(remint).toHaveBeenCalledTimes(1);
});
