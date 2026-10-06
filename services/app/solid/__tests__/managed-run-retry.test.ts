import { afterEach, expect, it, vi } from 'vitest';
import { startManagedRun } from '@/solid/lib/managed-run-retry';

const pending = () => ({ ok: false, status: 409, headers: new Headers({ 'Retry-After': '1' }), json: async () => ({ error: 'box_restart_pending' }) });
const accepted = () => ({ ok: true, status: 202, headers: new Headers(), json: async () => ({ session: { id: 'same-box' } }) });
const response = (ok: boolean, status: number, error: string) => ({ ok, status, headers: new Headers(), json: async () => ({ error }) });

afterEach(() => vi.restoreAllMocks());

it('retries only restart-pending with the exact same request body and bounded virtual time', async () => {
  let time = 0; const bodies: unknown[] = []; const signals:unknown[]=[]; const pendingStatus = vi.fn();
  const fetcher = vi.fn(async (_url: string, init: RequestInit) => { bodies.push(init.body);signals.push(init.signal);return bodies.length === 1 ? pending() : accepted(); });
  const body = JSON.stringify({ requestId: 'stable-once', name: 'box', command: ['codex'] });
  const result = await startManagedRun({ body, signal: new AbortController().signal, fetcher, now: () => time, sleep: async ms => { time += ms; }, onPending: pendingStatus });
  expect(result.session.id).toBe('same-box'); expect(fetcher).toHaveBeenCalledTimes(2); expect(bodies).toEqual([body, body]);
  expect(time).toBe(1000); expect(pendingStatus).toHaveBeenCalledTimes(1);expect(signals[0]).not.toBe(signals[1]);
});

it('does not retry unknown conflicts and stops at the fixed waiting budget', async () => {
  const unknown = vi.fn(async () => response(false, 409, 'box_configuration_conflict'));
  await expect(startManagedRun({ body: '{}', signal: new AbortController().signal, fetcher: unknown })).rejects.toThrow('box_configuration_conflict');
  expect(unknown).toHaveBeenCalledTimes(1);
  const stillPending = vi.fn(async () => pending());
  await expect(startManagedRun({ body: '{}', signal: new AbortController().signal, fetcher: stillPending, budgetMs: 500, now: () => 0, sleep: async () => {} })).rejects.toThrow(/still stopping/);
  expect(stillPending).toHaveBeenCalledTimes(1);
});

it('uses distinct timeout copy before teardown is confirmed and rejects malformed success bodies', async () => {
  const fetcher = vi.fn(async () => accepted());
  await expect(startManagedRun({ body: '{}', signal: new AbortController().signal, fetcher, budgetMs: 0, now: () => 0 })).rejects.toThrow('Could not start your hosted box in time. Try again.');
  expect(fetcher).not.toHaveBeenCalled();
  const malformed = vi.fn(async () => ({ ok: true, status: 202, headers: new Headers(), json: async () => ({ ok: true }) }));
  await expect(startManagedRun({ body: '{}', signal: new AbortController().signal, fetcher: malformed })).rejects.toThrow(/invalid session/);
  expect(malformed).toHaveBeenCalledTimes(1);
});

it('honors abort while waiting and does not issue another request', async () => {
  const controller = new AbortController(); const fetcher = vi.fn(async () => pending());
  const task = startManagedRun({ body: '{}', signal: controller.signal, fetcher, sleep: (_ms, signal) => new Promise((_, reject) => { if(signal.aborted) reject(signal.reason); else signal.addEventListener('abort', () => reject(signal.reason), { once: true }); }) });
  controller.abort(new DOMException('Aborted', 'AbortError'));
  await expect(task).rejects.toMatchObject({ name: 'AbortError' }); expect(fetcher).toHaveBeenCalledTimes(1);
});

it('keeps one restart request alive across a forty-five-second provider teardown', async () => {
 let time=0; const bodies:unknown[]=[]; const body=JSON.stringify({requestId:'long-reap-once',name:'box',command:['bash']});
 const fetcher=vi.fn(async (_url:string,init:RequestInit)=>{bodies.push(init.body);return time<45_000?pending():accepted();});
 const result=await startManagedRun({body,signal:new AbortController().signal,fetcher,now:()=>time,sleep:async ms=>{time+=ms;}});
 expect(result.session.id).toBe('same-box');expect(time).toBeGreaterThanOrEqual(45_000);expect(new Set(bodies)).toEqual(new Set([body]));
});

it('bounds each network attempt to thirty seconds and uses a fresh abort signal', async () => {
 vi.useFakeTimers();
 try {
  const signals:AbortSignal[]=[];
  let notifyStarted!:()=>void;const started=new Promise<void>(resolve=>{notifyStarted=resolve;});
  const fetcher=vi.fn(async (_url:string,init:RequestInit)=>{
   signals.push(init.signal as AbortSignal);
   notifyStarted();
   return new Promise<never>((_,reject)=>init.signal?.addEventListener('abort',()=>reject(init.signal?.reason),{once:true}));
  });
  const task=startManagedRun({body:'{}',signal:new AbortController().signal,fetcher});
  await started;
  const failure=expect(task).rejects.toThrow(/request timed out/i);
  await vi.advanceTimersByTimeAsync(30_000);
  await failure;
  expect(fetcher).toHaveBeenCalledTimes(1);expect(signals).toHaveLength(1);
 } finally { vi.useRealTimers(); }
});
