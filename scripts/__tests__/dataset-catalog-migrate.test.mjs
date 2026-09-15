import {describe,expect,it,vi} from 'vitest';
import {parseMigrationArgs,runMigrationCli} from '../dataset-catalog-migrate.mjs';
describe('dataset catalog migration CLI',()=>{
  it('is dry-run by default and refuses insecure credential transport',()=>{
    expect(parseMigrationArgs(['--url','http://127.0.0.1:6400'])).toMatchObject({dryRun:true,batchSize:25});
    expect(parseMigrationArgs(['--url','https://artifact.test','--apply'])).toMatchObject({dryRun:false});
    expect(()=>parseMigrationArgs(['--url','http://artifact.test'])).toThrow(/cleartext/i);
    expect(()=>parseMigrationArgs(['--url','https://u:p@artifact.test'])).toThrow(/userinfo/i);
  });
  it('retries transient failures and redacts conflict diagnostics',async()=>{
    const secret='never-print'; const lines=[]; const replies=[new Response('down',{status:503}),new Response(JSON.stringify({conflicts:[{artifactId:secret,reason:`bad-${secret}`}]}),{status:409})];
    const fetch=vi.fn(async()=>replies.shift());
    const result=await runMigrationCli({url:'https://artifact.test',dryRun:false,batchSize:1,retries:1,secret,fetch,saveReport:async()=>{},write:(line)=>lines.push(line)});
    expect(fetch).toHaveBeenCalledTimes(2); expect(result).toMatchObject({ok:false,reason:'conflict'});
    expect(lines.join('\n')).not.toContain(secret); expect(lines.join('\n')).toContain('[REDACTED]');
  });
});

it('backs up the whole preview before any write and applies only reviewed fingerprints',async()=>{
 const calls=[],saved=[];
 const plan={artifactId:'aaaaaa',fingerprint:'a'.repeat(64),before:{head:{id:'aaaaaa',source:'old'},history:[]},after:{head:{id:'aaaaaa',source:'new'},history:[]}};
 const fetch=vi.fn(async(_url,request)=>{const body=JSON.parse(request.body);calls.push(body);if(body.dryRun&&calls.length>2)return Response.json({dryRun:true,processed:0,changed:0,done:true,nextCursor:null,plans:[],conflicts:[]});if(body.dryRun)return Response.json({dryRun:true,processed:1,changed:1,done:false,nextCursor:null,plans:[plan],conflicts:[]});expect(saved).toHaveLength(1);return Response.json({dryRun:false,processed:1,changed:1,done:true,plans:[],conflicts:[]});});
 const result=await runMigrationCli({url:'https://artifact.test',dryRun:false,batchSize:1,retries:0,secret:'secret',fetch,write:()=>{},saveReport:async(report)=>{saved.push(report);}});
 expect(result.ok).toBe(true);expect(calls).toHaveLength(3);expect(calls[1].expected).toEqual({aaaaaa:plan.fingerprint});expect(saved[0].plans[0].before.head.source).toBe('old');
});
it('completes all dry-run pages and refuses to apply when backup fails',async()=>{
 const calls=[];const plan={artifactId:'aaaaaa',fingerprint:'a'.repeat(64),before:{},after:{}};
 const fetch=vi.fn(async(_url,request)=>{const body=JSON.parse(request.body);calls.push(body);return Response.json({dryRun:true,processed:1,changed:1,nextCursor:body.after?null:'aaaaaa',plans:[plan],conflicts:[]});});
 const saved=[];
 expect((await runMigrationCli({url:'https://artifact.test',dryRun:true,batchSize:1,retries:0,secret:'secret',fetch,write:()=>{},saveReport:async(report)=>saved.push(report)})).ok).toBe(true);
 expect(calls.map(call=>call.after)).toEqual([undefined,'aaaaaa']);expect(saved).toHaveLength(2);
 calls.length=0;
 await expect(runMigrationCli({url:'https://artifact.test',dryRun:false,batchSize:1,retries:0,secret:'secret',fetch,write:()=>{},saveReport:async()=>{throw new Error('disk full');}})).rejects.toThrow('disk full');
 expect(calls.every(call=>call.dryRun)).toBe(true);
});

it('audits after apply and refuses to call an incomplete migration finished',async()=>{
 const plan={artifactId:'aaaaaa',fingerprint:'a'.repeat(64)};let calls=0;
 const result=await runMigrationCli({url:'https://artifact.test',dryRun:false,batchSize:1,retries:0,secret:'secret',write:()=>{},saveReport:async()=>{},fetch:async()=>{
  calls++;
  return Response.json(calls===1?{dryRun:true,changed:1,processed:1,plans:[plan],conflicts:[],nextCursor:null,done:false}:calls===2?{dryRun:false,changed:1,processed:1,plans:[],conflicts:[],done:true}:{dryRun:true,changed:1,processed:1,plans:[plan],conflicts:[],nextCursor:null,done:false});
 }});
 expect(calls).toBe(3);expect(result).toMatchObject({ok:false,reason:'remaining'});
});

it('audits every exception-only page and reports completion with preserved historical exceptions',async()=>{
 const calls=[],saved=[],lines=[];
 const exceptions=[{artifactId:'aaaaaa',version:1,reason:'invalid JSX secret'},{artifactId:'zzzzzz',version:2,reason:'invalid SQL'}];
 const result=await runMigrationCli({url:'https://artifact.test',dryRun:false,batchSize:1,retries:0,secret:'secret',write:line=>lines.push(line),saveReport:async report=>saved.push(report),fetch:async(_url,request)=>{
  const body=JSON.parse(request.body);calls.push(body);
  return Response.json({dryRun:true,processed:1,changed:0,plans:[],conflicts:[],done:true,nextCursor:body.after?null:'aaaaaa',historicalExceptions:[exceptions[body.after?1:0]]});
 }});
 expect(calls.map(call=>call.after)).toEqual([undefined,'aaaaaa',undefined,'aaaaaa']);
 expect(saved).toHaveLength(4);
 expect(result).toMatchObject({ok:true,completion:'complete_with_historical_exceptions',report:{historicalExceptions:exceptions}});
 expect(lines.join('\n')).toContain('2 preserved historical exceptions');
 expect(lines.join('\n')).not.toContain('secret');
});

it('explicit partial mode backs up and applies valid artifacts while auditing every unresolved head',async()=>{
 const calls=[],saved=[];const conflict={artifactId:'bbbbbb',reason:'source unavailable'};
 const plan={artifactId:'aaaaaa',fingerprint:'a'.repeat(64),before:{head:{source:'old'},history:[]},after:{head:{source:'new'},history:[]}};
 const fetch=async(_url,request)=>{const body=JSON.parse(request.body);calls.push(body);const apply=!body.dryRun,final=calls.length>2;return Response.json({dryRun:body.dryRun,changed:final?0:1,processed:1,plans:final?[]:[plan],conflicts:apply?[]:[conflict],nextCursor:null,done:false},{status:apply?200:409});};
 const result=await runMigrationCli({url:'https://artifact.test',dryRun:false,allowPartial:true,batchSize:1,retries:0,secret:'secret',fetch,write:()=>{},saveReport:async report=>saved.push(report)});
 expect(calls).toHaveLength(3);expect(calls[1]).toMatchObject({dryRun:false,expected:{aaaaaa:plan.fingerprint}});
 expect(saved.length).toBeGreaterThanOrEqual(2);expect(result).toMatchObject({ok:false,reason:'remaining'});
});
