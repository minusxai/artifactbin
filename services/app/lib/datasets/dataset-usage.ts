/** Native authoring hints shared by dataset create responses and the catalog copy action: a page that reads it with sql. */
const attr=(value:string)=>value.replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;');
/** Stored datasets are linked by ID; the link's `data-af-name` is the dataset's table name in the page's sql. */
export function datasetQuerySnippet(id:string,name='data'):string {
 return `<link rel="af-dataset" data-af-name="${attr(name)}" href="ref:${attr(id)}">`;
}
function usage(id:string):string {
 return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Dataset rows</title><style>pre{white-space:pre-wrap;overflow-wrap:anywhere}</style>
${datasetQuerySnippet(id)}
</head><body><h1>Dataset rows</h1><p id="status">Loading…</p><pre id="rows"></pre>
<script type="module">
// The table is the link's data-af-name. Exact columns: node scripts/sql.mjs schema ${id}
import {sql} from '@afbin/apollo';
try {
 const [{n}]=await sql\`select count(*) as n from data\`;
 const rows=await sql\`select * from data limit 1000\`;
 document.querySelector('#rows').textContent=JSON.stringify(rows,null,2);
 document.querySelector('#status').textContent='Showing '+rows.length+' of '+n+' rows';
} catch(error) {document.querySelector('#status').textContent=error.message;}
</script></body></html>`;
}
/** Create-response contract: usage is publishable native HTML reading the dataset with sql, never retired JSX or the legacy namespace. */
export function datasetCreateFields(id:string,columns:unknown,rowCount:unknown,meta?:{totalRows?:number;truncated?:boolean},access:'read'|'readwrite'='read') {
 return {columns,rowCount,access,
  ...(meta?.truncated?{totalRows:meta.totalRows,truncated:true,note:`Source had ${meta.totalRows} rows; the first ${rowCount} were kept.`}:{}),
  ref:`ref:${id}`,usage:usage(id),
  writes:access==='read'
   ?`Read-only. Enable stored writes with PATCH /api/my/artifacts/${id} {"access":"readwrite"}, or set access on create/PUT. Dataset permissions still control each operation.`
   :`Write rows from the page with one sql statement each, every value bound with \${…}: insert into data (…) values (…); update data set … where _id = …; delete from data where _id = …; _id is generated, never set. Only the owner and editors write until the dataset's permissions allow more: node scripts/policy.mjs template NAME ${id} --output p.json, then dry-run and set it (/llms/permissions). Exact columns: node scripts/sql.mjs schema ${id}.`,
 };
}
