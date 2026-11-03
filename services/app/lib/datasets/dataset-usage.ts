/** Native authoring hints shared by dataset create responses and the catalog copy action: the generated dataset API. */
import {hasuraColumnNames} from './graphql-names';
const attr=(value:string)=>value.replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;');
/** Stored datasets are linked by ID; the link's `data-af-name` is the page's GraphQL root for the generated API. */
export function datasetQuerySnippet(id:string,name='data'):string {
 return `<link rel="af-dataset" data-af-name="${attr(name)}" href="ref:${attr(id)}">`;
}
/** The generated field names of a stored dataset's columns (`_id` first), as a fresh dataset's schema names them. */
function fieldsOf(columns:unknown):string[] {
 const names=Array.isArray(columns)?columns.flatMap(column=>column&&typeof column==='object'&&typeof (column as {name?:unknown}).name==='string'?[(column as {name:string}).name]:[]):[];
 return ['_id',...Object.values(hasuraColumnNames(names))];
}
/** A stable order for offset paging: the first column, then `_id` to break ties (rows are otherwise in `_id` hash order). */
function orderOf(fields:readonly string[]):string {
 return `[${[...fields.slice(1,2),'_id'].map(field=>`{${field}:asc}`).join(',')}]`;
}
function usage(id:string,columns:unknown):string {
 const fields=fieldsOf(columns);
 return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Dataset rows</title><script src="/af/core.js" data-af="core"></script>
${datasetQuerySnippet(id)}
</head><body><h1>Dataset rows</h1><p id="status">Loading…</p><pre id="rows"></pre>
<script type="module">
// Generated API: the root is the link's data-af-name. Exact fields: node scripts/graphql.mjs schema ${id}
import {client,gql} from '@afbin/apollo';
try {
 const rows=[];
 for(let offset=0;;offset+=1000){
  const {data,errors}=await client.query({query:gql\`query($offset:Int!){data(order_by:${orderOf(fields)},limit:1000,offset:$offset){${fields.join(' ')}}}\`,variables:{offset}});
  if(errors?.length)throw Error(errors[0].message);
  rows.push(...data.data);
  if(data.data.length<1000)break;
 }
 document.querySelector('#rows').textContent=JSON.stringify(rows,null,2);
 document.querySelector('#status').textContent='Showing all '+rows.length+' rows';
} catch(error) {document.querySelector('#status').textContent=error.message;}
</script></body></html>`;
}
/** Create-response contract: usage is publishable native HTML on the generated dataset API, never retired JSX or the legacy namespace. */
export function datasetCreateFields(id:string,columns:unknown,rowCount:unknown,meta?:{totalRows?:number;truncated?:boolean},access:'read'|'readwrite'='read') {
 return {columns,rowCount,access,
  ...(meta?.truncated?{totalRows:meta.totalRows,truncated:true,note:`Source had ${meta.totalRows} rows; the first ${rowCount} were kept.`}:{}),
  ref:`ref:${id}`,usage:usage(id,columns),
  writes:access==='read'
   ?`Read-only. Enable stored writes with PATCH /api/my/artifacts/${id} {"access":"readwrite"}, or set access on create/PUT. Dataset permissions still control each operation.`
   :`Write rows with the generated mutations on the link's root: insert_data_one(object:{…}), update_data_by_pk(pk_columns:{_id:ID},_set:{…}), delete_data_by_pk(_id:ID); _id is generated, never set. Only the owner and editors write until the dataset's permissions allow more: node scripts/policy.mjs template NAME ${id} --output p.json, then dry-run and set it (/llms/permissions). Exact names: node scripts/graphql.mjs schema ${id}.`,
 };
}
