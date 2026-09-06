import {describe,expect,it} from 'vitest';
import {useAppHarness,request} from './harness';
import {POST} from '@/app/api/admin/dataset-catalog/route';
useAppHarness();
const endpoint='/api/admin/dataset-catalog';
describe('admin dataset catalog migration door',()=>{
  it('is absent without the operator credential',async()=>{
    expect((await POST(request(endpoint,{method:'POST',json:{batchSize:1}}))).status).toBe(404);
    expect((await POST(request(endpoint,{method:'POST',headers:{'x-shared-secret':'wrong'},json:{batchSize:1}}))).status).toBe(404);
  });
  it('rejects unbounded and executable input',async()=>{
    for(const body of [{batchSize:0},{batchSize:101},{batchSize:1.5},{batchSize:1,failBeforeCommit:true},{batchSize:1,dryRun:'false'},{batchSize:1,maxHistoricalVersionsPerArtifact:10001},null,[]]){
      expect((await POST(request(endpoint,{method:'POST',headers:{'x-shared-secret':'test-secret'},json:body}))).status).toBe(400);
    }
  });
  it('defaults to dry-run at the HTTP door too',async()=>{
    const response=await POST(request(endpoint,{method:'POST',headers:{'x-shared-secret':'test-secret'},json:{batchSize:1}}));
    expect(response.status).toBe(200);expect(await response.json()).toMatchObject({dryRun:true,done:true});
  });
});
