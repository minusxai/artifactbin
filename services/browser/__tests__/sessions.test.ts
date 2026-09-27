import { describe, expect, it, vi } from 'vitest';
import { createBrowserSessions, type SessionWorker } from '../src/sessions';
import { DEFAULT_SESSION_CAPACITY } from '../src/session-config';

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

/**
 * A REFUSED CREATE NAMES NO SESSION. Capacity is shared by every owner (`BROWSER__SESSION_MAX`), and
 * the refusal used to echo the id the caller proposed — which the CLI printed as "Recover with", and
 * `status`/`close` on it then answered SESSION_NOT_FOUND. The refusal names what the CALLER can close,
 * and nothing that belongs to anybody else.
 */
it('refuses a create over capacity with no session id, listing only the caller\'s own open sessions', async () => {
  const sessions=createBrowserSessions(async()=>({run:async()=>({result:1,pages:[],attachments:[]}),close:async()=>{}}));
  const owner={credential:'bearer' as const,tokenId:'owner'};
  const stranger={credential:'bearer' as const,tokenId:'stranger'};
  const create=(actor:typeof owner,session_id:string)=>sessions.request({actor,op:'script',session_id,execution_id:`${session_id}-run`,create:true,code:'return 1'});
  try{
    await create(owner,'owner-one');
    await create(stranger,'stranger-one');
    const refused=await create(owner,'owner-two');
    expect(refused).toMatchObject({session_id:'',status:'failed',error:{code:'SESSION_CAPACITY'}});
    expect(refused.execution_id).toBeUndefined();
    expect(refused.error!.message).toContain('afbin sessions close owner-one');
    expect(refused.error!.message).not.toContain('stranger-one');
    // Nothing was created under the proposed id.
    expect((await sessions.request({actor:owner,op:'status',session_id:'owner-two'})).error?.code).toBe('SESSION_NOT_FOUND');

    await sessions.request({actor:owner,op:'close',session_id:'owner-one'});
    await create(stranger,'stranger-two');
    const none=await create(owner,'owner-three');
    expect(none.error?.code).toBe('SESSION_CAPACITY');
    expect(none.error!.message).not.toMatch(/stranger-/);
    expect(none.error!.message).toMatch(/none of them are yours/i);
  }finally{await sessions.close();}
});

/**
 * CAPACITY IS THE OPERATOR'S, AND NO ONE CREDENTIAL TAKES IT ALL. The global cap comes from
 * `BROWSER__SESSION_MAX` and a second cap, `BROWSER__SESSION_MAX_PER_ACTOR`, bounds what one owner
 * holds, so a single agent cannot fill every slot. The two refusals are told apart by code, and both
 * name only the caller's own sessions.
 */
describe('session capacity', () => {
  const worker=async()=>({run:async()=>({result:1,pages:[],attachments:[]}),close:async()=>{}});
  const actor=(tokenId:string)=>({credential:'bearer' as const,tokenId});
  const creator=(sessions:ReturnType<typeof createBrowserSessions>)=>(tokenId:string,session_id:string)=>
    sessions.request({actor:actor(tokenId),op:'script',session_id,execution_id:`${session_id}-run`,create:true,code:'return 1'});

  it('keeps the defaults of two in total and two per credential', () => {
    expect(DEFAULT_SESSION_CAPACITY).toEqual({sessions:2,sessionsPerActor:2});
  });

  it('enforces the global cap it is given, across owners', async () => {
    const sessions=createBrowserSessions(worker,{sessions:3,sessionsPerActor:3});
    const create=creator(sessions);
    try{
      expect((await create('a','a-1')).error).toBeUndefined();
      expect((await create('b','b-1')).error).toBeUndefined();
      expect((await create('c','c-1')).error).toBeUndefined();
      const refused=await create('a','a-2');
      expect(refused).toMatchObject({session_id:'',status:'failed',error:{code:'SESSION_CAPACITY'}});
      expect(refused.error!.message).toContain('at most 3 browser sessions');
      expect(refused.error!.message).toContain('afbin sessions close a-1');
      expect(refused.error!.message).not.toMatch(/[bc]-1/);
    }finally{await sessions.close();}
  });

  it('refuses one credential past its own cap while the server still has room, naming only its sessions', async () => {
    const sessions=createBrowserSessions(worker,{sessions:4,sessionsPerActor:2});
    const create=creator(sessions);
    try{
      await create('greedy','g-1');
      await create('greedy','g-2');
      const refused=await create('greedy','g-3');
      expect(refused).toMatchObject({session_id:'',status:'failed',error:{code:'SESSION_ACTOR_CAPACITY'}});
      expect(refused.execution_id).toBeUndefined();
      expect(refused.error!.message).toContain('at most 2 browser sessions');
      expect(refused.error!.message).toContain('afbin sessions close g-1');
      expect(refused.error!.message).toContain('afbin sessions close g-2');
      expect(refused.error!.message).not.toMatch(/none of them are yours/i);
      expect((await sessions.request({actor:actor('greedy'),op:'status',session_id:'g-3'})).error?.code).toBe('SESSION_NOT_FOUND');
      // Another credential is not held back by the first one's cap.
      expect((await create('other','o-1')).error).toBeUndefined();
      // Only LIVE sessions count: closing one frees the credential's slot.
      await sessions.request({actor:actor('greedy'),op:'close',session_id:'g-1'});
      expect((await create('greedy','g-3')).error).toBeUndefined();
    }finally{await sessions.close();}
  });

  it('names the per-credential limit when the caller hits both at once', async () => {
    const sessions=createBrowserSessions(worker,{sessions:2,sessionsPerActor:2});
    const create=creator(sessions);
    try{
      await create('solo','s-1');
      await create('solo','s-2');
      expect((await create('solo','s-3')).error?.code).toBe('SESSION_ACTOR_CAPACITY');
      // A different credential meets the global limit, and none of the open sessions are its own.
      const other=await create('other','o-1');
      expect(other.error?.code).toBe('SESSION_CAPACITY');
      expect(other.error!.message).toMatch(/none of them are yours/i);
    }finally{await sessions.close();}
  });
});
