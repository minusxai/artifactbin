import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runCli} from '../src/dispatch';
import {saveTestConnection} from './connection';
test('watch uses the changes API checkpoint and emits comment NDJSON before terminal access refusal',async()=>{
 const home=await mkdtemp(join(tmpdir(),'afbin-watch-'));const out:string[]=[];const seen:string[]=[];
 try{
 await saveTestConnection({server:'https://example.com',token:'mx_test'},home);
 const fetcher:typeof fetch=async(input)=>{const url=new URL(String(input));seen.push(url.pathname+url.search);
 if(!url.pathname.endsWith('/annotations/changes'))throw new Error('Unexpected request '+url.pathname);
 if(seen.length===1)return Response.json({events:[{type:'artifactbin.comment',event_id:'e1',artifact_id:'abc123',annotation_id:'ann1',comment_id:'c1',author:{kind:'human',label:'Human',user_id:'usr_one'},body:'Please fix',created_at:'2026-10-09T00:00:00Z'}],next_cursor:'checkpoint1',has_more:false});
 return Response.json({error:'not_found'},{status:404});};
 const code=await runCli(['watch','abc123','--comments','--json'],{home,cwd:home,interactive:false,fetch:fetcher,stdout:s=>out.push(s),stderr:()=>{}});
 assert.notEqual(code,0);assert.equal(seen.length,2,'watch should consume one page then stop on revoked access');
 assert.match(seen[1]!,/after=checkpoint1/);const events=out.join('').trim().split('\n').map(line=>JSON.parse(line));assert.ok(events.some(e=>e.event_id==='e1'&&e.body==='Please fix'));
 }finally{await rm(home,{recursive:true,force:true});}
});
