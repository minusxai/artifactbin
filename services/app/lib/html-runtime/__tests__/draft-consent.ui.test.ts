/**
 * A DRAFT'S LIVE DATA BEFORE THE READER ALLOWS IT (browser-client `draftSql`): a statement naming one of the draft's
 * `default:` links, on a mount the embedding app has not allowed to read live, rejects with its own code,
 * `consent_required`, and the list's sentence for the reader, never an access or outage failure; the draft's own
 * files still answer.
 */
import {afterEach,expect,it,vi} from 'vitest';
import {SQL_FAILURES} from '@artifactbin/contracts';

afterEach(()=>{vi.unstubAllGlobals();vi.resetModules();});

it('pauses a live read until the reader allows it, with its own code and a sentence saying so',async()=>{
 vi.stubGlobal('__AF_RUNTIME_CONFIG__',{pageId:'draft:x',revision:'draft',draft:true,backends:['wh'],draftConnections:['wh'],draftLive:false,offline:false});
 const {sql}=await import('../browser-client');
 const error=await Promise.resolve(sql`select item from wh.sales.orders`).then(()=>null,(e:unknown)=>e as {code:string;message:string;detail:string});
 expect(error).toMatchObject({code:'consent_required',message:SQL_FAILURES.consent_required.notice});
 expect(error!.detail).toContain('wh');
 expect(SQL_FAILURES.consent_required.notice).toMatch(/paused until you allow it/);
});
