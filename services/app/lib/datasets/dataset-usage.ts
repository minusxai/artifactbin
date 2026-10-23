/** Native authoring hints shared by dataset create responses and the catalog copy action. */
import type {DatasetCatalog} from './types';
const attr=(value:string)=>value.replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;');
/** Stored datasets are linked by ID; tables and columns are discovered through the namespace. */
export function datasetQuerySnippet(id:string,catalog?:DatasetCatalog,name='data'):string {
 if(catalog?.kind==='postgres')return 'Connected PostgreSQL sources cannot be linked through the native dataset GraphQL adapter. Import stored CSV or JSON rows to use an af-dataset namespace.';
 return `<link rel="af-dataset" data-af-name="${attr(name)}" href="ref:${attr(id)}" data-af-mode="live">`;
}
function usage(id:string,catalog?:DatasetCatalog):string {
 if(catalog?.kind==='postgres')return datasetQuerySnippet(id,catalog);
 return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Dataset rows</title><script src="/af/v1/core.js" data-af="core"></script>
${datasetQuerySnippet(id,catalog)}
</head><body><h1>Dataset rows</h1><p id="status">Loading…</p><pre id="rows"></pre>
<script type="module">
import {client,gql} from '@afbin/apollo';
try {
 const schema=await client.query({query:gql\`{data{schema{revision tables{id label columns{id label type}}}}}\`});
 if(schema.errors?.length)throw Error(schema.errors[0].message);
 const table=schema.data.data.schema.tables[0];if(!table)throw Error('No table found');
 const result=await client.query({query:gql\`query($table:ID!){data{rows(tableId:$table,first:100){revision source{truncated totalRows storedRows} rows{id cells{columnId value{type string number boolean json}}} pageInfo{hasNextPage endCursor}}}}\`,variables:{table:table.id}});
 if(result.errors?.length)throw Error(result.errors[0].message);
 const rows=result.data.data.rows;
 document.querySelector('#rows').textContent=JSON.stringify(rows.rows,null,2);
 document.querySelector('#status').textContent='Showing '+rows.rows.length+' stored rows at revision '+rows.revision+(rows.pageInfo.hasNextPage?' (more pages available; continue with after: endCursor)':'')+(rows.source.truncated?' (upload was truncated)':'');
} catch(error) {document.querySelector('#status').textContent=error.message;}
</script></body></html>`;
}
/** Create-response contract: usage is publishable native HTML for stored rows, never retired JSX. */
export function datasetCreateFields(id:string,columns:unknown,rowCount:unknown,meta?:{totalRows?:number;truncated?:boolean;catalog?:DatasetCatalog},access:'read'|'readwrite'='read') {
 const postgres=meta?.catalog?.kind==='postgres',effectiveAccess=postgres?'read':access;
 return {columns,rowCount,access:effectiveAccess,
  ...(meta?.truncated?{totalRows:meta.totalRows,truncated:true,note:`Source had ${meta.totalRows} rows; the first ${rowCount} were kept.`}:{}),
  ref:`ref:${id}`,usage:usage(id,meta?.catalog),
  writes:postgres?'PostgreSQL database rows are read-only. Editors can manage the connection, notebook and whitelist. Viewers can query exposed data.':effectiveAccess==='read'
   ?`Read-only. Enable stored writes with PATCH /api/my/artifacts/${id} {"access":"readwrite"}, or set access on create/PUT. Dataset policy still controls each operation.`
   :'Use data.writeRows(tableId, expectedRevision, requestId, changes) through GraphQL. Discover stable column IDs with data.schema; cells use {columnId,value:{type:NUMBER,number:12}} (or STRING/string, BOOLEAN/boolean, JSON/json). Changes use kind INSERT/UPDATE/DELETE and UPDATE/DELETE require rowId. Use the current dataset revision, a unique idempotent requestId, and inspect outcome committed/rejected/unknown. Dataset access and policy independently authorize each write.',
 };
}
