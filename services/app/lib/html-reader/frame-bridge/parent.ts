import {isCellKey,REGION_UPDATE_MAX_BYTES,type RegionCaret,type RegionFrameMessage,type RegionParentMessage,type UploadContext} from '@artifactbin/contracts';
import {isRegionId,isRegionPosition} from '@/lib/html-presence/model';
/** Validation/body transport is an intentional lazy browser chunk, loaded only by an admitted upload call. */
const loadUploadRelay=()=>import('./upload');
/** Parent transport for the native HTML reader. Messages must come from the
 * current iframe, expected origin and session key. The only HTTP relay is this
 * page's GraphQL endpoint, pinned to the trusted shell's revision and read mode.
 */
import { runtimeId } from '@artifactbin/utils/runtime-id';
import { STORY_DATA_MESSAGE, STORY_FRAME_BRIDGE_MESSAGE, STORY_URL_VALUES_MESSAGE, isFrameBridgeEnvelope, type FrameBridgeFramePayload, type FrameBridgeParentPayload, type IslandStoryController } from '@/lib/html-reader/contract';

interface HtmlRelayContext { revision: string; readOnly: boolean; uploadSession?:{state:'loading'|'signed-out'|'signed-in'|'unavailable';subject?:string} }
interface FrameBridgeParentOptions {
  /** Set by the trusted HTML shell, never by a page message. */
  htmlContext?: () => HtmlRelayContext;
  win: Window;
  frame: HTMLIFrameElement;
  /** The framed document's origin: its pages origin, or `'null'` for the sandboxed `/raw` copy (development). */
  frameOrigin: string;
  id: string;
  /** The served version's source nodes (createIslandController `nodes`); a saved version sent by `update` replaces them. */
  /** Read when attaching; later values go out through `setContext`. */
  editId: () => string;
  source: () => string | null;
  /** How the page makes a relayed request (default: its own same-origin fetch, with its session). */
  appFetch?: (path: string, init: RequestInit) => Promise<Response>;
  /** The frame's controller runs and signs its events with `nonce` ('' while a reloaded frame's new controller starts). */
  onReady?: (nonce: string) => void;
  /** The framed document scrolled. */
  onScroll?: (scroll: { x: number; y: number }) => void;
  /** The bridge closed itself (the frame navigated away, or reported it cannot run the editor). */
  onClosed?: (reason: string) => void;
  /** The document's link moved: `search` is what the page's address's `$` params should now say (`''` at rest). */
  onUrlValues?: (search: string) => void;
  /** The reader first pressed, touched, typed or selected in a document attached without its tree (contract `pressed`). */
  onPressed?: () => void;
}

export interface FrameBridgeParent extends IslandStoryController {
  /**
   * A region message to the frame's editor (contracts region-sessions). Until `regions-enabled` names a region for the
   * current document, every other region message is dropped: a reader's frame is never told of a session. A document
   * that loads anew starts with regions off.
   */
  sendRegion(message: RegionParentMessage): void;
  /** Whether the current document has regions enabled (a `regions-enabled` with at least one region was sent to it). */
  regionsEnabled(): boolean;
  /** The frame's region messages, validated (regionFrameMessage). Returns the stop. */
  subscribeRegion(listener: (message: RegionFrameMessage) => void): () => void;
  /**
   * The current document's editor caret: its last `region-caret`, null after `region-blur` or a new document. A presence
   * session that starts again (a new revision) publishes it at once; the editor sends a caret only when it moves.
   */
  regionCaret(): RegionCaret | null;
  /** The editor's newer head pointer and source, which the frame's controller reads live. */
  refreshUploadContext():void;
  setContext(editId: string, source: string | null): void;
  /**
   * How far the page's bars reach over the frame's top edge (contract `inset`). Kept, and sent again to every
   * controller that starts (a document that loads anew starts with none reserved).
   */
  setTopInset(px: number): void;
  /**
   * The tree for a bridge made without one (`nodes: []`): the running frame controller classifies against it from
   * now on (contract `nodes`) — no new session, so a selection the reader already made gets its bubble — and a
   * document that loads again is attached with it. Ignored once the bridge holds a tree.
   */
}

/** The longest `$` query a document may hand the page's address. */
const MAX_URL_VALUES = 8192;

/** A document's `$` params as the page will take them (STORY_URL_VALUES_MESSAGE), or null: a bounded query, no hash or space. */
export function urlValuesOf(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const { type, search } = data as { type?: unknown; search?: unknown };
  if (type !== STORY_URL_VALUES_MESSAGE || typeof search !== 'string' || search.length > MAX_URL_VALUES) return null;
  return /^\??[^#\s]*$/.test(search) ? search : null;
}

/** The longest link a region's editor reports at its caret (Mod-K). */
const MAX_REGION_HREF = 2048;
/** Short names the frame's editor reports (active marks, the caret's block type). */
const regionName=(value:unknown):value is string=>typeof value==='string'&&/^[a-z][a-z0-9_-]{0,31}$/i.test(value);
/** A region message from the frame as the page will take it (contracts RegionFrameMessage, rebuilt field by field), or null. */
export function regionFrameMessage(payload: unknown): RegionFrameMessage | null {
  if (!payload || typeof payload !== 'object') return null;
  const raw = payload as Record<string, unknown>;
  switch (raw.kind) {
    // A dataset text cell (@afbin/collab) opens and updates under its cell key, as a region does under its id.
    case 'region-open': return isRegionId(raw.regionId) || isCellKey(raw.regionId) ? { kind: 'region-open', regionId: raw.regionId } : null;
    case 'region-update':
      return (isRegionId(raw.regionId) || isCellKey(raw.regionId)) && raw.update instanceof Uint8Array && raw.update.byteLength > 0 && raw.update.byteLength <= REGION_UPDATE_MAX_BYTES
        ? { kind: 'region-update', regionId: raw.regionId, update: raw.update } : null;
    case 'region-caret':
      if (!isRegionId(raw.regionId) || !isRegionPosition(raw.anchor) || !isRegionPosition(raw.head) || !regionName(raw.block)) return null;
      if (!Array.isArray(raw.marks) || raw.marks.length > 16 || !raw.marks.every(regionName)) return null;
      return { kind: 'region-caret', regionId: raw.regionId, anchor: raw.anchor, head: raw.head, marks: [...raw.marks] as string[], block: raw.block };
    case 'region-blur': return { kind: 'region-blur' };
    case 'region-slash':
      return isRegionId(raw.regionId) && Number.isFinite(raw.x) && Number.isFinite(raw.y) ? { kind: 'region-slash', regionId: raw.regionId, x: raw.x as number, y: raw.y as number } : null;
    case 'region-link':
      // Only shown in the page's link dialog, which checks any URL again before it is sent back.
      return isRegionId(raw.regionId) && (raw.href === null || (typeof raw.href === 'string' && raw.href.length <= MAX_REGION_HREF)) ? { kind: 'region-link', regionId: raw.regionId, href: raw.href } : null;
    default: return null;
  }
}
const REGION_FRAME_KINDS = new Set(['region-open', 'region-update', 'region-caret', 'region-blur', 'region-slash', 'region-link']);

/** The response headers a relayed answer keeps: what the controller reads. */
const KEPT_HEADERS = ['content-type', 'retry-after'];
/** The request headers a relayed request may carry. */
const SENT_HEADERS = ['content-type'];
/** A mutation's Idempotency-Key (@afbin/apollo, one per client.mutate): relayed for mutations only, in its own shape. */
const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{16,128}$/;

const sameOriginFetch = (win: Window) => (path: string, init: RequestInit): Promise<Response> =>
  win.fetch(path, { ...init, credentials: 'same-origin', cache: 'no-store' });

/** The relayed request, checked: this document's GraphQL path, on the page's own origin, or null. */
export function relayedRequest(win: Window, id: string, request: { path: unknown; method: unknown; headers: unknown; body: unknown }, htmlContext?: HtmlRelayContext): { path: string; init: RequestInit } | null {
  if (typeof request.path !== 'string' || (request.method !== 'GET' && request.method !== 'POST')) return null;
  let url: URL;
  try { url = new URL(request.path, win.location.origin); } catch { return null; }
  if (url.origin !== win.location.origin) return null;
  const graphql = url.pathname === `/api/artifacts/${encodeURIComponent(id)}/graphql` && request.method === 'POST' && !url.search && !url.hash;
  // The page SQL door: its own path, or (the reader's one request relay, html-runtime browser-client `sql`) the GraphQL path
  // with `operation: 'sql'`, routed here to /sql.
  if ((url.pathname === `/api/artifacts/${encodeURIComponent(id)}/sql` || graphql && sqlBody(request.body)) && request.method === 'POST' && !url.search && !url.hash) return relayedSql(new URL(`/api/artifacts/${encodeURIComponent(id)}/sql`, url), request, htmlContext);
  if (!graphql) return null;
  let graphqlBody: string | undefined;
  let mutation = false;
  if (graphql) {
    if (!htmlContext?.revision || typeof request.body !== 'string' || request.body.length > 1_000_000) return null;
    try {
      const input: unknown = JSON.parse(request.body);
      if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
      const body = input as Record<string, unknown>;
      if (typeof body.query !== 'string' || !['query', 'mutation'].includes(String(body.operation)) || htmlContext.readOnly && body.operation !== 'query') return null;
      mutation = body.operation === 'mutation';
      graphqlBody = JSON.stringify({ ...body, revision: htmlContext.revision });
    } catch { return null; }
  }
  const headers: Record<string, string> = {};
  if (request.headers && typeof request.headers === 'object') {
    for (const [name, value] of Object.entries(request.headers as Record<string, unknown>)) {
      if (SENT_HEADERS.includes(name.toLowerCase()) && typeof value === 'string') headers[name] = value;
      else if (mutation && name.toLowerCase() === 'idempotency-key' && typeof value === 'string' && IDEMPOTENCY_KEY.test(value)) headers['Idempotency-Key'] = value;
    }
  }
  const body = graphqlBody ?? (request.method === 'POST' && typeof request.body === 'string' ? request.body : undefined);
  return { path: url.pathname + url.search, init: { method: request.method, headers, ...(body !== undefined ? { body } : {}) } };
}

/** lib/page-operations FUNCTION_NAME and lib/page-graphql FUNCTION_REVISION_HEADER, restated (the parent chunk carries no server value). */
const FUNCTION_NAME = /^[_A-Za-z][_0-9A-Za-z]{0,63}$/;
const FUNCTION_REVISION_HEADER = 'x-page-revision';
const MAX_RELAYED_BODY = 1_000_000;
const refusal = (status: number, error: string) => ({ status, body: JSON.stringify({ error }) });
/**
 * A page function call (html-runtime/fn-fetch), checked: this document's function path on the page's own origin, a
 * name that is an identifier, GET without a body or POST with a bounded one. The shell's revision is pinned in its
 * own header and the frame's only header is its content type, so the call runs as this reader, on this revision.
 * `null`: not a function path at all; `{status}`: a function path refused, answered with that status.
 */
function relayedFunctionRequest(win: Window, id: string, request: { path: unknown; method: unknown; headers: unknown; body: unknown }, htmlContext?: HtmlRelayContext): { path: string; init: RequestInit } | { status: number; body: string } | null {
  if (typeof request.path !== 'string') return null;
  let url: URL;
  try { url = new URL(request.path, win.location.origin); } catch { return null; }
  const prefix = `/api/artifacts/${encodeURIComponent(id)}/fn/`;
  if (url.origin !== win.location.origin || !url.pathname.startsWith(prefix)) return null;
  if (!FUNCTION_NAME.test(url.pathname.slice(prefix.length)) || url.hash) return refusal(404, 'unknown_function');
  if (!htmlContext?.revision) return refusal(403, 'not_permitted');
  // A read-only shell (an archived view) relays reads only, as its GraphQL and uploads do.
  if (htmlContext.readOnly && request.method !== 'GET') return refusal(403, 'read_only');
  if (request.method === 'GET' ? request.body !== null && request.body !== undefined : request.method !== 'POST' || (request.body !== null && typeof request.body !== 'string')) return refusal(400, 'invalid_request');
  if (typeof request.body === 'string' && request.body.length > MAX_RELAYED_BODY) return refusal(413, 'payload_too_large');
  const headers: Record<string, string> = { [FUNCTION_REVISION_HEADER]: htmlContext.revision };
  const type = request.headers && typeof request.headers === 'object' ? (request.headers as Record<string, unknown>)['content-type'] : undefined;
  if (typeof type === 'string') headers['content-type'] = type;
  // The pinned header is the revision: a frame's own `revision` parameter is dropped (the server refuses a mismatch).
  url.searchParams.delete('revision');
  return { path: url.pathname + url.search, init: { method: request.method as 'GET' | 'POST', headers, ...(typeof request.body === 'string' ? { body: request.body } : {}) } };
}

/** A relayed body the page runtime's `sql` sent through the GraphQL relay (`operation: 'sql'`). */
function sqlBody(body: unknown): boolean {
  if (typeof body !== 'string' || body.length > MAX_RELAYED_BODY) return false;
  try { return (JSON.parse(body) as { operation?: unknown } | null)?.operation === 'sql'; } catch { return false; }
}

/**
 * The page SQL door (lib/page-graphql `pageSqlDoor`): `{sql, params}` only, the trusted revision and read-only state
 * bound here (the server refuses a read-only page's writes; the parent cannot tell a read from a write). Any statement
 * may write, so its well-formed Idempotency-Key is always relayed.
 */
function relayedSql(url: URL, request: { headers: unknown; body: unknown }, htmlContext?: HtmlRelayContext): { path: string; init: RequestInit } | null {
  if (!htmlContext?.revision || typeof request.body !== 'string' || request.body.length > 1_000_000) return null;
  let input: unknown;
  try { input = JSON.parse(request.body); } catch { return null; }
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const { sql, params = {} } = input as { sql?: unknown; params?: unknown };
  if (typeof sql !== 'string' || !params || typeof params !== 'object' || Array.isArray(params)) return null;
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries((request.headers && typeof request.headers === 'object' ? request.headers : {}) as Record<string, unknown>)) {
    if (typeof value !== 'string') continue;
    if (SENT_HEADERS.includes(name.toLowerCase())) headers[name] = value;
    else if (name.toLowerCase() === 'idempotency-key' && IDEMPOTENCY_KEY.test(value)) headers['Idempotency-Key'] = value;
  }
  return { path: url.pathname, init: { method: 'POST', headers, body: JSON.stringify({ sql, params, revision: htmlContext.revision, ...(htmlContext.readOnly ? { readOnly: true } : {}) }) } };
}

export function createFrameBridgeParent(options: FrameBridgeParentOptions): FrameBridgeParent {
  const { win, frame, frameOrigin, id } = options;
  const appFetch = options.appFetch ?? sameOriginFetch(win);
  const target = frameOrigin === 'null' ? '*' : frameOrigin;
  let key = runtimeId();
  let nonce = '';
  let pendingUploads=0;
  const uploadControllers=new Set<AbortController>();
  let uploadSignature='',uploadContext:UploadContext={state:'unavailable',scope:runtimeId()};
  /** In-flight page function calls by bridge call id: `fetch-cancel`, a new document or closing aborts them. */
  const functionCalls=new Map<number,AbortController>();
  const cancelUploads=()=>{for(const controller of uploadControllers)controller.abort();uploadControllers.clear();for(const controller of functionCalls.values())controller.abort();functionCalls.clear();};
  const readUploadContext=()=>{
    const html=options.htmlContext?.(),session=html?.uploadSession;
    const state:UploadContext['state']=!html?'unavailable':html.readOnly?'read-only':session?.state??'unavailable';
    const signature=JSON.stringify([key,options.editId(),options.source(),html?.revision,state,session?.subject]);
    if(signature!==uploadSignature){uploadSignature=signature;cancelUploads();uploadContext={state,scope:runtimeId()};}
    return uploadContext;
  };
  /** The frame's controller answered `ready` under the current key: commands go straight out. */
  let attached = false;
  let closed = false;
  let loads = 0;
  /** Commands the page sent before the frame's controller ran: posted on `ready`, in order. */
  const backlog: FrameBridgeParentPayload[] = [];
  const listeners = new Set<(event: unknown) => void>();
  const regionListeners = new Set<(message: RegionFrameMessage) => void>();
  /** The current document was told which regions it may edit (sendRegion `regions-enabled`). */
  let regionsOn = false;
  let caret: RegionCaret | null = null;
  /** The page's bars over the frame's top edge (setTopInset): every new frame controller is told on `ready`. */
  let inset = 0;
  /**
   * The nodes of the newest saved version the page sent (`update` without a source), else the served ones: what a
   * controller that starts — the first, or one in a document that loaded again — classifies selections against.
   */

  const envelope = (payload: FrameBridgeParentPayload) => {
    try { frame.contentWindow?.postMessage({ type: STORY_FRAME_BRIDGE_MESSAGE, key, payload }, target); } catch { /* the frame went away */ }
  };
  const post = (payload: FrameBridgeParentPayload) => {
    if (closed) return;
    if (!attached) { backlog.push(payload); return; }
    envelope(payload);
  };
  /** (Re)send this session's attach: the door starts the frame half on the first one and ignores a key it holds. */
  const attach = () => {
    if (attached || closed || !frame.contentWindow) return;
    envelope({ kind: 'attach', id, editId: options.editId(), source: options.source(), ...(options.htmlContext?{uploadContext:readUploadContext()}:{}) });
  };
  /** A new document in the frame: its controller is gone, so a new session starts under a fresh key. */
  const reattach = () => {
    cancelUploads();
    key = runtimeId();
    nonce = '';
    attached = false;
    // What the page sent to the old document's controller does not carry over to the new one's.
    backlog.length = 0;
    regionsOn = false;
    caret = null;
    options.onReady?.('');
    attach();
  };
  const close = (reason: string) => {
    if (closed) return;
    try { frame.contentWindow?.postMessage({ type: STORY_FRAME_BRIDGE_MESSAGE, key, payload: { kind: 'detach' } }, target); } catch { /* gone */ }
    cancelUploads();
    closed = true;
    key = '';
    options.onClosed?.(reason);
  };

  const relay = async (payload: Extract<FrameBridgeFramePayload, { kind: 'fetch' }>) => {
    const relayKey=key;
    const reply=(answer:FrameBridgeParentPayload)=>{if(key===relayKey)post(answer);};
    const call = relayedFunctionRequest(win, id, payload, options.htmlContext?.());
    if (call && 'status' in call) { reply({ kind: 'fetch-result', call: payload.call, status: call.status, headers: { 'content-type': 'application/json' }, body: call.body }); return; }
    if (call) {
      const controller = new AbortController();
      functionCalls.get(payload.call)?.abort();
      functionCalls.set(payload.call, controller);
      try {
        const response = await appFetch(call.path, { ...call.init, signal: controller.signal });
        const headers: Record<string, string> = {};
        response.headers.forEach((value, name) => { if (KEPT_HEADERS.includes(name.toLowerCase())) headers[name.toLowerCase()] = value; });
        const body = await response.text();
        if (!controller.signal.aborted) reply({ kind: 'fetch-result', call: payload.call, status: response.status, headers, body });
      } catch (error) {
        if (!controller.signal.aborted) reply({ kind: 'fetch-result', call: payload.call, error: String(error instanceof Error ? error.message : error) });
      } finally { if (functionCalls.get(payload.call) === controller) functionCalls.delete(payload.call); }
      return;
    }
    const request = relayedRequest(win, id, payload, options.htmlContext?.());
    if (!request) {
      if (payload.path === `/api/artifacts/${encodeURIComponent(id)}/sql` || sqlBody(payload.body)) reply({ kind: 'fetch-result', call: payload.call, status: 403, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ error: 'permission_denied', message: 'This page request is not permitted' }) });
      else if (payload.path === `/api/artifacts/${encodeURIComponent(id)}/graphql`) reply({ kind: 'fetch-result', call: payload.call, status: 403, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ data: null, errors: [{ message: 'This page request is not permitted' }] }) });
      else reply({ kind: 'fetch-result', call: payload.call, error: 'refused' });
      return;
    }
    try {
      const response = await appFetch(request.path, request.init);
      const headers: Record<string, string> = {};
      response.headers.forEach((value, name) => { if (KEPT_HEADERS.includes(name.toLowerCase())) headers[name.toLowerCase()] = value; });
      reply({ kind: 'fetch-result', call: payload.call, status: response.status, headers, body: await response.text() });
    } catch (error) {
      reply({ kind: 'fetch-result', call: payload.call, error: String(error instanceof Error ? error.message : error) });
    }
  };

  const onMessage = (event: MessageEvent) => {
    if (closed || event.source !== frame.contentWindow || event.origin !== frameOrigin) return;
    const values = urlValuesOf(event.data);
    if (values !== null) { options.onUrlValues?.(values); return; }
    if (!isFrameBridgeEnvelope(event.data)) return;
    const data = event.data as { key?: unknown; payload: FrameBridgeFramePayload };
    const payload = data.payload;
    if (payload.kind === 'hello') {
      // A door that opens after this session's controller ran is a new document (it reloaded).
      if (attached && frameOrigin !== 'null') reattach(); else attach();
      return;
    }
    if (data.key !== key) return;
    if (REGION_FRAME_KINDS.has(payload.kind)) {
      const message = regionFrameMessage(payload);
      if (message?.kind === 'region-caret') caret = { regionId: message.regionId, anchor: message.anchor, head: message.head };
      else if (message?.kind === 'region-blur') caret = null;
      if (message) for (const listener of [...regionListeners]) listener(message);
      return;
    }
    switch (payload.kind) {
      case 'ready':
        if (typeof payload.nonce !== 'string' || !payload.nonce) return;
        nonce = payload.nonce;
        attached = true;
        for (const queued of backlog.splice(0)) envelope(queued);
        if (inset) envelope({ kind: 'inset', top: inset });
        const values = urlValuesOf({ type: STORY_URL_VALUES_MESSAGE, search: payload.urlValues });
        if (values !== null) options.onUrlValues?.(values);
        options.onReady?.(nonce);
        return;
      case 'event':
        for (const listener of [...listeners]) listener(payload.event);
        return;
      case 'upload-file': {
        const current=readUploadContext();
        const context=options.htmlContext?.();
        if(current.state!=='signed-in'||!context||pendingUploads>=4){post({kind:'fetch-result',call:payload.call,status:403,headers:{'content-type':'application/json'},body:JSON.stringify({error:'Upload is not permitted in this reader'})});return;}
        pendingUploads++;
        const controller=new AbortController();uploadControllers.add(controller);
        const uploadKey=key,uploadScope=current.scope;const reply=(answer:FrameBridgeParentPayload)=>{if(!closed&&key===uploadKey&&readUploadContext().scope===uploadScope)post(answer);};
        const editId=options.editId();
        void (async()=>{try{const {relayFileUpload}=await loadUploadRelay();if(controller.signal.aborted||closed||key!==uploadKey||readUploadContext().scope!==uploadScope)return;await relayFileUpload({documentId:id,editId,readOnly:context.readOnly,input:payload,signal:controller.signal,appFetch,reply});}catch{reply({kind:'fetch-result',call:payload.call,error:'Upload outcome unknown'});}finally{pendingUploads--;uploadControllers.delete(controller);}})();return;
      }
      case 'fetch': void relay(payload); return;
      case 'fetch-cancel': functionCalls.get(payload.call)?.abort(); functionCalls.delete(payload.call); return;
      case 'pressed': options.onPressed?.(); return;
      case 'scroll': options.onScroll?.({ x: Number(payload.scrollX) || 0, y: Number(payload.scrollY) || 0 }); return;
      case 'error': console.error('[frame-bridge]', payload.message); return;
      default: return;
    }
  };
  const onLoad = () => {
    loads++;
    // A second document in the frame. On `/raw` its origin says nothing, so the bridge closes.
    // On its own origin a new document's door says `hello` as it opens, which re-attaches; a load only re-sends.
    if (loads > 1 && frameOrigin === 'null') { close('the framed document navigated'); return; }
    attach();
  };
  win.addEventListener('message', onMessage);
  frame.addEventListener('load', onLoad);
  // The frame may already be there, its door open and its hello gone (the server drew it before this page ran).
  attach();

  const controller: FrameBridgeParent = {
    get nonce() { return nonce; },
    send(command: unknown) { post({ kind: 'send', command }); },
    invalidate(datasets: string[]) { post({ kind: 'send', command: { type: STORY_DATA_MESSAGE, datasets } }); },
    subscribe(listener: (event: unknown) => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    sendRegion(message: RegionParentMessage) {
      if (message.kind === 'regions-enabled') { if (message.regionIds.length) regionsOn = true; }
      // A cell's messages answer the frame's own `region-open`: never gated on page regions.
      else if (!regionsOn && !('regionId' in message && isCellKey(message.regionId))) return;
      post(message);
    },
    regionsEnabled: () => regionsOn && !closed,
    subscribeRegion(listener: (message: RegionFrameMessage) => void) { regionListeners.add(listener); return () => { regionListeners.delete(listener); }; },
    regionCaret: () => caret,
    /** The frame's viewport in this page's viewport: its content box, inside the iframe's border. */
    getViewportRect() {
      const box = frame.getBoundingClientRect();
      return new DOMRect(box.left + frame.clientLeft, box.top + frame.clientTop, frame.clientWidth, frame.clientHeight);
    },
    refreshUploadContext(){if(options.htmlContext)post({kind:'upload-context',context:readUploadContext()});},
    setContext(editId: string, source: string | null) { post({ kind: 'context', editId, source });if(options.htmlContext)post({kind:'upload-context',context:readUploadContext()}); },
    setTopInset(px: number) {
      const top = Number.isFinite(px) ? Math.max(0, Math.round(px)) : 0;
      if (top === inset) return;
      inset = top;
      // Not backlogged: `ready` sends the current one (a reloaded document's backlog is dropped, the inset is not).
      if (attached && !closed) envelope({ kind: 'inset', top });
    },
    dispose() {
      close('disposed');
      listeners.clear();
      regionListeners.clear();
      win.removeEventListener('message', onMessage);
      frame.removeEventListener('load', onLoad);
    },
  };
  return controller;
}
