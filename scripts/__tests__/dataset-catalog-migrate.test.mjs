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
    const result=await runMigrationCli({url:'https://artifact.test',dryRun:false,batchSize:1,retries:1,secret,fetch,write:(line)=>lines.push(line)});
    expect(fetch).toHaveBeenCalledTimes(2); expect(result).toMatchObject({ok:false,reason:'conflict'});
    expect(lines.join('\n')).not.toContain(secret); expect(lines.join('\n')).toContain('[REDACTED]');
  });
});
