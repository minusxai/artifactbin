/**
 * `?intent=` — the one-shot instruction a door leaves on the way back in.
 *
 * Some journeys leave a document and have to come back to it DOING the thing
 * that was asked — "fork this" and "log in to comment" are the two covered
 * here, and like/follow travel the same way. Without this the person returns
 * to a document that has forgotten what they pressed, and does the work twice.
 *
 * Four properties, and each of them is a way this could go wrong:
 *  - a STRICT ALLOWLIST. It rides on a SHARED link, so anybody may append
 *    anything; `?intent=delete` must be silence, not an error and certainly
 *    not an act.
 *  - a fork ASKS. It writes into someone's account, and the address that asked
 *    for it is one anyone could have handed over.
 *  - it is consumed ONCE and stripped, so a refresh does not re-prompt.
 *  - stripping keeps the rest of the address exactly as it was: the reader's
 *    `$` values live in this same query string and are their own selection.
 */
import {compiledOf} from '@/test/helpers/compiled';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { render } from '@/test/helpers/surface-ui';
import { readIntent, stripIntent, withIntent } from '@/lib/intent';

const layerProps: Array<Record<string, unknown>> = [];
vi.mock('@/components/AnnotationLayer', () => ({
  default: (props: Record<string, unknown>) => { layerProps.push(props); return null; },
}));

import ArtifactShell from '../ArtifactShell';
import ArtifactSurface, { type ArtifactSurfaceProps } from '../ArtifactSurface';

class FakeEventSource {
  addEventListener() {}
  removeEventListener() {}
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  close() {}
}

const ok201 = { ok: true, status: 201, json: async () => ({ id: 'copy01', url: 'http://localhost:3000/@me/copy01-doc' }) };

beforeEach(() => {
  layerProps.length = 0;
  localStorage.clear();
  vi.stubGlobal('EventSource', FakeEventSource);
  vi.stubGlobal('fetch', vi.fn(async () => ok201) as unknown as typeof fetch);
  window.history.replaceState(null, '', '/a/story1');
});
afterEach(() => { vi.unstubAllGlobals(); });

const props = (over: Partial<ArtifactSurfaceProps> = {}): ArtifactSurfaceProps => ({
  id: 'story1', editId: 'edit_1', format: 'markup', title: 'Quarterly report', source: null, template: null,
  refs: [], version: 1, dataPreview: '', columns: [], compiledCss: null, theme: null, colorMode: null,
  ...over,
});

/** The address the page really has, and the `search` prop the router feeds it — both. */
const at = (url: string, over: Partial<ArtifactSurfaceProps> = {}, role: 'owner' | 'editor' | 'commenter' = 'owner') => {
  window.history.replaceState(null, '', url);
  const search = new URL(url, 'http://localhost:3000').search;
  return render(
    <ArtifactShell role={role}>
      <ArtifactSurface {...props({ search, ...over })} />
    </ArtifactShell>,
  );
};

describe('the allowlist is the whole parser', () => {
  it('names only what the page is designed to be asked', () => {
    expect(readIntent('?intent=fork')).toBe('fork');
    expect(readIntent('?intent=comment')).toBe('comment');
    for (const hostile of ['?intent=delete', '?intent=', '?intent=FORK', '?', '', '?$region=west']) {
      expect(readIntent(hostile), hostile).toBeNull();
    }
  });

  it('strips only itself, byte for byte, and can be written back on', () => {
    expect(stripIntent('?intent=fork&$region=west')).toBe('?$region=west');
    // Never re-encoded: `$` and a space survive exactly as the link carried them.
    expect(stripIntent('?%24team=LA+Lakers&intent=comment')).toBe('?%24team=LA+Lakers');
    expect(stripIntent('?intent=fork')).toBe('');
    expect(stripIntent('?$a=1')).toBe('?$a=1');
    // `version` selects WHICH VERSION of the document is being read
    // (lib/archived-version); consuming an instruction must never send the
    // reader back to the head.
    expect(stripIntent('?version=2&intent=like')).toBe('?version=2');
    expect(withIntent('?$region=west', 'fork')).toBe('?$region=west&intent=fork');
    expect(withIntent('', 'comment')).toBe('?intent=comment');
    // Asking twice is asking once.
    expect(withIntent('?intent=comment', 'fork')).toBe('?intent=fork');
  });
});

describe('?intent=fork asks before it writes', () => {
  it('opens the confirm, names the document, and forks on confirm', async () => {
    at('/a/story1?intent=fork');
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Quarterly report');

    fireEvent.click(screen.getByLabelText('Confirm fork'));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/my/artifacts/story1/fork', expect.objectContaining({ method: 'POST' })));
  });

  it('cancel closes it and forks nothing', async () => {
    at('/a/story1?intent=fork');
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByLabelText('Cancel fork'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    // The dialog's dry run (what a fork WOULD copy) is the one POST allowed here: it creates nothing.
    const writes = (fetch as unknown as { mock: { calls: Array<[string, RequestInit | undefined]> } }).mock.calls
      .filter(([url, init]) => url === '/api/my/artifacts/story1/fork' && !String(init?.body ?? '').includes('dry_run'));
    expect(writes).toEqual([]);
  });

  it('Escape cancels it too, and the confirm holds focus', async () => {
    at('/a/story1?intent=fork');
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});

describe('?intent=comment opens the conversation', () => {
  it('is the comments row and nothing more — no mode, no hash', async () => {
    at('/a/story1?intent=comment', {}, 'commenter');
    await waitFor(() => expect(layerProps.at(-1)).toMatchObject({ railOpen: true }));
    expect(window.location.hash).toBe('');
  });
});

describe('anything else is silence', () => {
  it('ignores an intent the page was never designed to be asked', async () => {
    at('/a/story1?intent=delete');
    await waitFor(() => expect(window.location.search).toBe(''));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(layerProps.at(-1) ?? { railOpen: false }).toMatchObject({ railOpen: false });
  });
});

describe('the instruction is consumed, and only it', () => {
  it('leaves the reader\'s own selection and their place in the document alone', async () => {
    at('/a/story1?intent=fork&$region=west#section-3');
    await screen.findByRole('dialog');
    await waitFor(() => expect(window.location.search).toBe('?$region=west'));
    expect(window.location.hash).toBe('#section-3');
    expect(window.location.pathname).toBe('/a/story1');
  });

  it('takes the whole query away when the intent was all of it', async () => {
    at('/a/story1?intent=comment', {}, 'commenter');
    await waitFor(() => expect(window.location.search).toBe(''));
  });
});

const mutationFlow: NonNullable<ArtifactSurfaceProps['dataflow']> = {flow:await compiledOf('<Import name="data" src="ref:data01" /><Mutation name="save">{`delete from data.rows`}</Mutation>',{data01:[{name:'id',type:'string'}]})};
const localFlow=await compiledOf('<Value name="cart" type="table" value={[{"id":"a"}]} /><Mutation name="clear">{`delete from cart`}</Mutation>');
describe('membership in the reader breadcrumb',()=>{
 it('sends signed-out Join through login with the return intent',async()=>{
  at('/a/story1', {dataflow:mutationFlow,accountSession:false});
  fireEvent.click(screen.getByRole('button',{name:'Join artefact'}));
  await waitFor(()=>expect(window.location.pathname).toBe('/login'));
  expect(decodeURIComponent(window.location.search)).toContain('intent=join');
 });
 it('joins once on return from login and shows the acknowledged state',async()=>{
  let joined=false;
  const state={members:[],pending:[],self:null,canManage:true,canInvite:true};
  vi.stubGlobal('fetch',vi.fn(async(_url:string,options?:RequestInit)=>{if(options?.method==='POST')joined=true;return new Response(JSON.stringify(joined?{...state,self:{status:'accepted',direction:'request'}}:state));}));
  at('/a/story1?intent=join',{dataflow:mutationFlow,accountSession:true});
  await waitFor(()=>expect(fetch).toHaveBeenCalledWith('/api/my/artifacts/story1/members',expect.objectContaining({method:'POST',body:JSON.stringify({action:'join'})})));
  expect(window.location.search).toBe('');
  expect(await screen.findByRole('button',{name:'Joined — view people'})).toBeInTheDocument();
 });
 it('does not offer membership for a document with only local mutations',()=>{
  at('/a/story1',{dataflow:{flow:localFlow}});
  expect(screen.queryByRole('button',{name:'Join artefact'})).toBeNull();
 });
});
