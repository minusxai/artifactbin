/** Installed SQL transports wait for the server's bounded read, without resetting on retry. */
import {afterEach, expect, it, vi} from 'vitest';
import {makeClient, platform} from '../../../skills/artifactbin/scripts/toolbox-client.mjs';
import {sqlCommand} from '../../../skills/artifactbin/scripts/sql.mjs';
import {SQL_QUERY_MAX_MS, SQL_WALL_OVERHEAD_MS} from '@artifactbin/contracts';

const server='https://example.test';
const env={ARTIFACTBIN_URL:server,ARTIFACTBIN_TOKEN:'synthetic'};
afterEach(()=>{vi.restoreAllMocks();vi.useRealTimers();});

it.each([
  ['page read','query','PAGE12','select 1',{},SQL_QUERY_MAX_MS+SQL_WALL_OVERHEAD_MS+5000],
  ['page evidence schema','schema','PAGE12',undefined,{revision:'2'},140000],
  ['dataset read','query','DATA12','select 1',{},140000],
  ['dataset schema','schema','DATA12',undefined,{},140000],
  ['default read','query','default:example','select 1',{},920000],
  ['page write','query','PAGE12',"insert into rows(n) values (1)",{},30000],
  ['dataset write','query','DATA12',"insert into rows(n) values (1)",{},30000],
] as const)('gives %s its finite transport envelope',async(_label,sub,id,sql,values,budget)=>{
  const timeouts:number[]=[];
  const timeout=AbortSignal.timeout.bind(AbortSignal);
  vi.spyOn(AbortSignal,'timeout').mockImplementation(ms=>{timeouts.push(ms);return timeout(ms);});
  let requestBudget=0;
  await sqlCommand({sub,values,positionals:[id,...sql?[sql]:[]]}, {env,fetcher:async(url:any)=>{
    const route=new URL(url).pathname;
    if(route==='/api/artifacts/PAGE12')return Response.json({format:'html',version:2});
    if(route==='/api/artifacts/DATA12')return Response.json({format:'dataset',version:2});
    requestBudget=timeouts.at(-1)!;
    return Response.json({revision:'2',tables:[],columns:[],rows:[],results:[{columns:[],rows:[]}],affected:1,returning:[]});
  }});
  expect(requestBudget).toBe(budget);
});

it('does not renew the request deadline on a transient retry',async()=>{
  await platform();
  vi.useFakeTimers();
  let calls=0;
  const signals:AbortSignal[]=[];
  const client=makeClient(server,{env,retryDelays:[0],fetcher:async(_url:any,init:any)=>{
    calls++;signals.push(init.signal);
    await new Promise<void>((resolve,reject)=>{
      const stop=()=>{clearTimeout(timer);reject(init.signal.reason);};
      const timer=setTimeout(()=>{init.signal.removeEventListener('abort',stop);resolve();},60);
      init.signal.addEventListener('abort',stop,{once:true});
      if(init.signal.aborted)stop();
    });
    return calls===1?Response.json({},{status:503}):Response.json({ok:true});
  }});
  // AbortSignal.timeout uses native timers; tie it to the controlled clock for this proof.
  vi.spyOn(AbortSignal,'timeout').mockImplementation(ms=>{
    const c=new AbortController();setTimeout(()=>c.abort(new DOMException('expired','TimeoutError')),ms);return c.signal;
  });
  const result=client.request('/api/artifacts/PAGE12',{timeoutMs:100}).catch((e:any)=>e);
  await vi.advanceTimersByTimeAsync(150);
  expect(await result).toMatchObject({code:'network_unavailable'});
  expect(calls).toBe(2);
  expect(signals[0]).toBe(signals[1]);
  vi.useRealTimers();
});
