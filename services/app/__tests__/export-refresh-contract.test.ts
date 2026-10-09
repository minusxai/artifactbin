import {expect,it} from 'vitest';
import {z} from 'zod';
import {OPERATIONS} from '@/lib/operations/registry';
it('keeps an explicit fresh-image request at the export operation boundary',()=>{
 const operation=OPERATIONS.find(operation=>operation.name==='export_artifact')!;
 const input=z.object(operation.input).parse({id:'fresh-static-table',refresh:true});
 expect(input).toMatchObject({id:'fresh-static-table',refresh:true});
});
