import {describe,it,expect} from 'vitest';
import {compileDatasetSql} from '../../services/app/lib/datasets/sql';
import {modelNoticeSql,physicalNoticeSql,invalidRecipientSql} from '../fixtures/postgres-notifications.mjs';
const columns=[{name:'id',type:'number'},{name:'region',type:'string'},{name:'amount',type:'number'}];
const physical={kind:'postgres',defaultSchema:'sales',refreshSeconds:0,tables:[{schema:'sales',name:'orders',source:{schema:'sales',table:'orders'},columns}]};
const model={...physical,defaultSchema:'models',notebookSources:[{schema:'sales',name:'orders',columns}],notebook:{cells:[
 {id:'raw',name:'raw_orders',sql:'select region, amount from sales.orders'},
 {id:'totals',name:'region_totals',sql:'select region, sum(amount)::int as total from raw_orders group by region order by region'},
]},tables:[{schema:'models',name:'region_totals',modelCellId:'totals',columns:[{name:'region',type:'string'},{name:'total',type:'number'}]}]};
describe('real PostgreSQL notification gate authored SQL',()=>{
 for(const [name,catalog,sql] of [['native array/model',model,modelNoticeSql],['physical source',physical,physicalNoticeSql],['invalid JSON-text recipient',model,invalidRecipientSql]]){
  it(`compiles ${name} under the existing dataset SQL policy`,()=>{
   const compiled=compileDatasetSql(catalog,sql,{recipient:'usr_gate_recipient'},{recipient:'string'});
   expect(compiled.values).toContain('usr_gate_recipient');
   expect(compiled.sql).toMatch(/sales/);
   expect(compiled.sql).not.toContain('$recipient');
   // Output validation rejects JSON text later; it must reach the real worker.
   if(name==='native array/model')expect(compiled.sql.toLowerCase()).toMatch(/array\s*\[/);
  });
 }
});
