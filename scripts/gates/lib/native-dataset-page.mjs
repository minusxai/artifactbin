/** Native author fixture: persistent viewer selections use Apollo only.
 * Shared rows remain temporary, fully paginated revision-consistent results.
 */
import { pageHtml } from "../../fixtures/page-speed/native.mjs";
/** @param {(query:string, variables?:object)=>Promise<any>} query */
export async function readDataset(query) {
  const schema = (await query("{data{schema{revision tables{id label columns{id label type nullable}}}}}")).data.schema;
  const table = schema.tables[0];
  if (!table) throw Error("Dataset has no table");
  const rows = [];
  let after = null;
  let source;
  do {
    const page = (await query("query($table:ID!,$after:String){data{rows(tableId:$table,first:100,after:$after){revision source{truncated totalRows storedRows} rows{id cells{columnId value{type string number boolean json}}} pageInfo{hasNextPage endCursor}}}}", { table: table.id, after })).data.rows;
    if (page.revision !== schema.revision) throw Error("Dataset changed while reading; refresh required");
    rows.push(...page.rows);
    source = page.source;
    const cursor = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
    if (page.pageInfo.hasNextPage && (!cursor || cursor === after)) throw Error("Dataset cursor did not advance");
    after = cursor;
  } while (after);
  return { revision: schema.revision, table, rows, source };
}
export function datasetPageHtml(datasetId, { title = "Live data", mode = "live", revision, writable = true } = {}) {
  const body = `<link rel="af-dataset" data-af-name="data" href="ref:${datasetId}" data-af-mode="${mode}"${revision ? ` data-af-revision="${revision}"` : ""}>
<h1 id="heading">${title}</h1><label>Choice <select id="choice"><option>ramen</option><option>tacos</option><option>salad</option></select></label>
<button id="vote"${writable ? "" : " disabled"}>Vote</button><button id="refresh">Refresh</button><output id="receipt" role="status"></output><p id="total"></p><p id="source"></p><div id="tally"></div><table><thead></thead><tbody></tbody></table>`;
  return pageHtml(title, body, `import {onBackendChange} from '@afbin/apollo';
const readDataset=${readDataset.toString()};
const state=gql\`{choice}\`;let current;
const query=async(text,variables)=>{const result=await client.query({query:gql(Object.assign([text],{raw:[text]})),variables});if(result.errors?.length)throw Error(result.errors.map(e=>e.message).join('; '));return result.data};
function value(cell){return cell?.value?.[{STRING:'string',NUMBER:'number',BOOLEAN:'boolean',JSON:'json'}[cell?.value?.type]]??null}
async function refresh(){try{current=await readDataset(query);document.querySelector('#total').textContent='rows: '+current.rows.length;document.querySelector('#source').textContent=current.source.truncated?'Stored sample: '+current.source.storedRows+' of '+current.source.totalRows:'Complete: '+current.source.totalRows;
const column=current.table.columns.find(c=>c.label==='choice');const totals=new Map();for(const row of current.rows){const choice=value(row.cells.find(c=>c.columnId===column?.id));totals.set(choice,(totals.get(choice)||0)+1)}document.querySelector('#tally').replaceChildren(...[...totals].map(([choice,count])=>{const p=document.createElement('p');p.textContent=choice+' '+count;return p}));
const head=document.createElement('tr');for(const c of current.table.columns){const th=document.createElement('th');th.textContent=c.label;head.append(th)}document.querySelector('thead').replaceChildren(head);document.querySelector('tbody').replaceChildren(...current.rows.map(row=>{const tr=document.createElement('tr');tr.dataset.rowId=row.id;for(const col of current.table.columns){const td=document.createElement('td');const v=value(row.cells.find(c=>c.columnId===col.id));td.textContent=v===null?'NULL':typeof v==='object'?JSON.stringify(v):String(v);tr.append(td)}return tr}));document.documentElement.dataset.afReady='yes';}catch(error){document.querySelector('#receipt').textContent=error.message;throw error}}
client.watchQuery({query:state}).subscribe(({data})=>{document.querySelector('#choice').value=data.choice});
document.querySelector('#choice').onchange=event=>client.updateQuery({query:state},()=>({choice:event.target.value}));
document.querySelector('#refresh').onclick=()=>refresh().catch(()=>{});
document.querySelector('#vote').onclick=async()=>{document.querySelector('#receipt').textContent='';try{const {data}=await client.query({query:state});const col=current.table.columns.find(c=>c.label==='choice');const result=await client.mutate({mutation:gql\`mutation($table:ID!,$revision:String!,$request:ID!,$changes:[data__RowChange!]!){data{writeRows(tableId:$table,expectedRevision:$revision,requestId:$request,changes:$changes){outcome revision rowIds}}}\`,variables:{table:current.table.id,revision:current.revision,request:"vote-"+Date.now()+"-"+Math.random(),changes:[{kind:'INSERT',cells:[{columnId:col.id,value:{type:'STRING',string:data.choice}}]}]}});if(result.errors?.length)throw Error(result.errors.map(e=>e.message).join('; '));const outcome=result.data.data.writeRows.outcome;document.querySelector('#receipt').textContent=outcome;if(outcome==='committed')await refresh();}catch(error){document.querySelector('#receipt').textContent='Write refused: '+error.message}};
onBackendChange(names=>{if(names.includes('data'))void refresh().catch(()=>{})});await refresh();`, { choice: "ramen" });
}
