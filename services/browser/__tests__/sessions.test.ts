import { expect, it, vi } from 'vitest';
import { createBrowserSessions, type SessionWorker } from '../src/sessions';

it('persists execution IDs before waiting, serializes scripts, and refuses cross-owner access and replay', async () => {
  const release: Array<() => void> = [];
  const run = vi.fn(async (code: string) => { await new Promise<void>(resolve => release.push(resolve)); return { result: code, pages: [], attachments: [] }; });
  const close = vi.fn(async () => {});
  const sessions = createBrowserSessions(async () => ({ run, close }));
  const actor = { credential: 'bearer' as const, tokenId: 'owner' };
  const first = { actor, op: 'script' as const, session_id: 'one', execution_id: 'first', create: true, code: 'return 1' };
  try {
    expect((await sessions.request(first)).status).toBe('queued');
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    expect((await sessions.request(first)).status).toBe('running');
    expect(await sessions.request({actor,op:'status',session_id:'one'})).toMatchObject({execution_id:'first',status:'running'});
    expect((await sessions.request({ ...first, code: 'return 2' })).error?.code).toBe('EXECUTION_CONFLICT');
    expect((await sessions.request({ ...first, actor: { ...actor, tokenId: 'stranger' } })).error?.code).toBe('SESSION_NOT_FOUND');
    await sessions.request({ ...first, execution_id: 'second', code: 'return 2' });
    expect(run).toHaveBeenCalledTimes(1);
    release.shift()!();
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(2));
    release.shift()!();
    await vi.waitFor(async () => expect((await sessions.request({ actor, op: 'status', session_id: 'one', execution_id: 'second' })).result).toBe('return 2'));
    await sessions.request({ actor, op: 'close', session_id: 'one' });
    expect(close).toHaveBeenCalledOnce();
    expect((await sessions.request({ ...first, execution_id: 'third' })).error?.code).toBe('SESSION_LOST');
  } finally { await sessions.close(); }
});

it('never starts a script after closing a session whose worker is still starting', async () => {
  let admit!: (worker: SessionWorker) => void;
  const run = vi.fn(async () => ({ result: 'too late', pages: [], attachments: [] }));
  const close = vi.fn(async () => {});
  const sessions = createBrowserSessions(() => new Promise(resolve => { admit = resolve; }));
  const actor = { credential: 'bearer' as const, tokenId: 'owner' };
  try {
    await sessions.request({ actor, op: 'script', session_id: 'starting', execution_id: 'first', create: true, code: 'commit()' });
    await vi.waitFor(async () => expect((await sessions.request({ actor, op: 'status', session_id: 'starting' })).status).toBe('running'));
    const closing = sessions.request({ actor, op: 'close', session_id: 'starting' });
    admit({ run, close });
    await closing;
    expect(run).not.toHaveBeenCalled();
    expect((await sessions.request({ actor, op: 'status', session_id: 'starting', execution_id: 'first' })).status).toBe('closed');
  } finally { await sessions.close(); }
});

it('reports artifact identity for a page inside an artifact, not only its canonical address', async () => {
  const sessions=createBrowserSessions(async()=>({run:async()=>({pages:[{page_id:'page',url:'http://app/@owner/abc123-report/edit'}],attachments:[]}),close:async()=>{}}));
  const actor={credential:'bearer' as const,tokenId:'owner'};
  try{
    await sessions.request({actor,op:'script',session_id:'nested',execution_id:'open',create:true,code:'return 1'});
    await vi.waitFor(async()=>expect((await sessions.request({actor,op:'status',session_id:'nested',execution_id:'open'})).pages).toEqual([{page_id:'page',url:'http://app/@owner/abc123-report/edit',artifact_id:'abc123'}]));
  }finally{await sessions.close();}
});

it('reports artifact identity for canonical page addresses', async () => {
  const sessions=createBrowserSessions(async()=>({run:async()=>({pages:[{page_id:'page',url:'http://app/@owner/abc123-report?$region=South'}],attachments:[]}),close:async()=>{}}));
  const actor={credential:'bearer' as const,tokenId:'owner'};
  try{
    await sessions.request({actor,op:'script',session_id:'canonical',execution_id:'open',create:true,code:'return 1'});
    await vi.waitFor(async()=>expect((await sessions.request({actor,op:'status',session_id:'canonical',execution_id:'open'})).pages).toEqual([{page_id:'page',url:'http://app/@owner/abc123-report?$region=South',artifact_id:'abc123'}]));
  }finally{await sessions.close();}
});
