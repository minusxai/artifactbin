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
  });

  it('retries bounded transient failures, resumes until done, and stops on conflicts without leaking the secret',async()=>{
    const secret='never-print-this';
    const replies=[
      new Response('upstream detail '+secret,{status:503}),
      new Response(JSON.stringify({done:false,cursor:'aaaaaa',conflicts:[]}),{status:200,headers:{'content-type':'application/json'}}),
      new Response(JSON.stringify({error:'migration_conflict',done:false,conflicts:[{artifactId:'bbbbbb',reason:'history_limit'}]}),{status:409,headers:{'content-type':'application/json'}}),
    ];
    const fetch=vi.fn(async()=>replies.shift()); const lines=[];
    const result=await runMigrationCli({url:'https://artifact.test',dryRun:false,batchSize:1,retries:1,secret,fetch,write:(line)=>lines.push(line)});
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(result).toMatchObject({ok:false,reason:'conflict'});
    expect(lines.join('\n')).toContain('bbbbbb');
    expect(lines.join('\n')).not.toContain(secret);
  });
});
