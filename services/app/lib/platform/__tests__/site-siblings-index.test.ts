import {expect,it} from 'vitest';
import {useAppHarness} from '@/__tests__/harness';

const harness=useAppHarness();
it('indexes the public-sibling title probe of a published site',async()=>{
 const db=await harness.db();
 const rows=(await db.query<{indexdef:string}>(`SELECT indexdef FROM pg_indexes WHERE indexname='idx_artifacts_site_siblings'`)).rows;
 expect(rows).toHaveLength(1);
 const def=rows[0]!.indexdef;
 expect(def).toMatch(/\(ancestor_ids, .*regexp_replace.*, user_id, group_id\)/);
 for(const part of ['deleted_at IS NULL',`visibility = 'public'`,'title IS NOT NULL','html','folder'])expect(def).toContain(part);
});
