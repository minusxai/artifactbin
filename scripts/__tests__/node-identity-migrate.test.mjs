import {describe,expect,it,vi} from 'vitest';
import {parseMigrationArgs,runMigrationCli} from '../node-identity-migrate.mjs';

describe('node identity migration operator CLI',()=>{
  it('defaults to dry-run and requires an explicit apply switch',()=>{
    expect(parseMigrationArgs(['--url','http://127.0.0.1:6400'])).toMatchObject({dryRun:true,batchSize:25});
    expect(parseMigrationArgs(['--url','https://artifact.test','--apply','--batch-size','10','--history-limit','50'])).toMatchObject({dryRun:false,batchSize:10,historyLimit:50});
    expect(()=>parseMigrationArgs(['--wat'])).toThrow(/unknown argument/);
  });

  it('refuses to send the credential over non-loopback cleartext HTTP',()=>{
    expect(()=>parseMigrationArgs(['--url','http://artifact.test','--apply'])).toThrow(/cleartext/i);
    expect(()=>parseMigrationArgs(['--url','http://0.0.0.0:6400'])).toThrow(/cleartext/i);
    expect(parseMigrationArgs(['--url','http://localhost:6400']).url).toBe('http://localhost:6400');
    expect(()=>parseMigrationArgs(['--url','https://operator:password@artifact.test'])).toThrow(/userinfo|credential/i);
  });

  it('refuses redirects and aborts every timed-out attempt',async()=>{
    const seen=[];
    const fetch=vi.fn((_url,init)=>new Promise((_resolve,reject)=>{
      seen.push(init);
      init.signal.addEventListener('abort',()=>reject(init.signal.reason),{once:true});
    }));
    const result=await runMigrationCli({url:'https://artifact.test',dryRun:true,batchSize:1,retries:0,timeoutMs:5,secret:'secret',fetch,write:()=>{}});
    expect(result).toMatchObject({ok:false,reason:'request'});
    expect(seen).toHaveLength(1);
    expect(seen[0].redirect).toBe('error');
    expect(seen[0].signal.aborted).toBe(true);
  });

  it('stops an apply loop whose successful responses make no cursor progress',async()=>{
    const body=()=>new Response(JSON.stringify({done:false,cursor:'same',processed:0,conflicts:[]}),{status:200});
    const fetch=vi.fn(async()=>body());
    const result=await runMigrationCli({url:'https://artifact.test',dryRun:false,batchSize:1,retries:0,secret:'secret',fetch,write:()=>{}});
    expect(result).toMatchObject({ok:false,reason:'no_progress'});
    expect(fetch.mock.calls.length).toBeLessThanOrEqual(2);
  });

  it('retries bounded transient failures, resumes until done, and stops on conflicts without leaking the secret',async()=>{
    const secret='never-print-this';
    const replies=[
      new Response('upstream detail '+secret,{status:503}),
      new Response(JSON.stringify({done:false,cursor:'aaaaaa',processed:1,conflicts:[]}),{status:200,headers:{'content-type':'application/json'}}),
      new Response(JSON.stringify({error:'migration_conflict',done:false,conflicts:[{artifactId:'bbbbbb',reason:'history_limit'}]}),{status:409,headers:{'content-type':'application/json'}}),
    ];
    const fetch=vi.fn(async()=>replies.shift()); const lines=[];
    const result=await runMigrationCli({url:'https://artifact.test',dryRun:false,batchSize:1,retries:1,secret,fetch,write:(line)=>lines.push(line)});
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(result).toMatchObject({ok:false,reason:'conflict'});
    expect(lines.join('\n')).toContain('bbbbbb');
    expect(lines.join('\n')).not.toContain(secret);
  });

  it('redacts the actual secret even when a conflict echoes it in machine fields',async()=>{
    const secret='actual-secret-value'; const lines=[];
    const fetch=async()=>new Response(JSON.stringify({done:false,conflicts:[{artifactId:secret,reason:`bad-${secret}`}]}),{status:409});
    await runMigrationCli({url:'https://artifact.test',dryRun:false,batchSize:1,retries:0,secret,fetch,write:line=>lines.push(line)});
    expect(lines.join('\n')).not.toContain(secret);
    expect(lines.join('\n')).toContain('[REDACTED]');
  });
});
