import { describe, expect, it } from 'vitest';
import { useAppHarness, request } from './harness';
import { POST } from '@/app/api/admin/node-identity/route';

const harness=useAppHarness();
const endpoint='/api/admin/node-identity';
describe('admin identity migration door',()=>{
  it('is absent to callers without the operator credential',async()=>{
    expect((await POST(request(endpoint,{method:'POST',json:{batchSize:1}}))).status).toBe(404);
    expect((await POST(request(endpoint,{method:'POST',headers:{'x-shared-secret':'wrong'},json:{batchSize:1}}))).status).toBe(404);
    await expect((await harness.db()).query('SELECT 1 FROM node_identity_migration_jobs').then(r=>r.rows)).resolves.toHaveLength(0);
  });
  it('rejects unbounded or executable input before any migration work',async()=>{
    for(const body of [{batchSize:0},{batchSize:101},{batchSize:1.5},{batchSize:1,failBeforeCommit:'x'},{batchSize:1,dryRun:'false'},
      {batchSize:1,maxHistoricalVersionsPerArtifact:-1},{batchSize:1,maxHistoricalVersionsPerArtifact:10001},null,[]]) {
      const res=await POST(request(endpoint,{method:'POST',headers:{'x-shared-secret':'test-secret'},json:body}));
      expect(res.status).toBe(400);
    }
  });
  it('dry-run is read-only and an empty live run persists completion',async()=>{
    const invoke=(body:unknown)=>POST(request(endpoint,{method:'POST',headers:{'x-shared-secret':'test-secret'},json:body}));
    const dry=await invoke({batchSize:1,dryRun:true});expect(dry.status).toBe(200);expect(await dry.json()).toMatchObject({dryRun:true,done:true});
    expect((await (await harness.db()).query('SELECT 1 FROM node_identity_migration_jobs')).rows).toHaveLength(0);
    const live=await invoke({batchSize:1});expect(live.status).toBe(200);expect(await live.json()).toMatchObject({dryRun:false,done:true});
    expect((await (await harness.db()).query('SELECT completed_at FROM node_identity_migration_jobs')).rows[0].completed_at).toBeTruthy();
  });
  it('returns a machine-visible non-success while a manual identity conflict blocks progress',async()=>{
    const db=await harness.db();
    await db.query(`INSERT INTO artifacts (id,token_id,content,source,format) VALUES
      ('aaaaaa','tok_admin','','<p data-annotation-anchor="same">A</p><p data-annotation-anchor="same">B</p>','markup')`);
    const res=await POST(request(endpoint,{method:'POST',headers:{'x-shared-secret':'test-secret'},json:{batchSize:1}}));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({error:'migration_conflict',incomplete:true,done:false,conflicts:[{artifactId:'aaaaaa',reason:'ambiguous_legacy_key'}]});
  });
});
