import type { StandaloneDatasetPagePlan } from "./contracts.ts";
import { createExternalDatasetPageReader } from "./external-reader.ts";
const escape = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
const json = (value: unknown) => JSON.stringify(value).replace(/</g, "\\u003c");
/** Registered names only. Remote query results are transient and have no known total. */
export function renderExternalDatasetPage(
  plan: Extract<StandaloneDatasetPagePlan, { kind: "external-ready" }>,
): string {
  const source = plan.source;
  return `<!doctype html><html lang="en" data-af-design-system="signout"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(plan.title)}</title><script data-af="core" src="${escape(plan.coreUrl)}"></script><link rel="af-backend" data-af-name="legacyData" href="${escape(source.backendHref)}"><style>body{margin:0;background:var(--background,#fff);color:var(--foreground,#17202a);font:1rem/1.5 system-ui,sans-serif}main{max-width:80rem;margin:auto;padding:2rem}h1{overflow-wrap:anywhere}select,button{font:inherit;padding:.5rem}nav{display:flex;gap:.75rem;margin-top:1rem}.table-scroll{overflow:auto}table{border-collapse:collapse;width:100%}th,td{text-align:left;vertical-align:top;border-bottom:1px solid var(--border,#ddd);padding:.5rem;max-width:30rem;overflow-wrap:anywhere}th{background:var(--muted,#f6f8fa)}</style></head><body><main><h1>${escape(plan.title)}</h1><label for="dataset-table">Table</label><select data-af-id="dataset-table" id="dataset-table">${source.tables.map((t, i) => `<option value="${i}">${escape(t.schema + "." + t.table)}</option>`).join("")}</select><p data-af-id="dataset-status" role="status" aria-live="polite">Loading data…</p><div class="table-scroll"><table data-af-id="dataset-grid"><thead></thead><tbody></tbody></table></div><nav aria-label="Table pages"><button data-af-id="dataset-previous" disabled>Previous</button><button data-af-id="dataset-next" disabled>Next</button><button data-af-id="dataset-refresh">Refresh</button></nav></main><script type="module">
import {gql,client} from '@afbin/apollo';
const source=${json(source)},makeReader=${createExternalDatasetPageReader.toString()};
const query=gql\`query ExternalDatasetPageRead($name:String!,$valuesJson:String!,$offset:Int!,$limit:Int!){legacyData{sourceQuery(name:$name,valuesJson:$valuesJson,offset:$offset,limit:$limit)}}\`;
const reader=makeReader(source,async variables=>{const result=await client.query({query,variables,fetchPolicy:'network-only'});if(result.errors?.length||typeof result.data?.legacyData?.sourceQuery!=='string')throw Error();return JSON.parse(result.data.legacyData.sourceQuery);});
const select=document.querySelector('#dataset-table'),grid=document.querySelector('[data-af-id="dataset-grid"]'),status=document.querySelector('[data-af-id="dataset-status"]'),previous=document.querySelector('[data-af-id="dataset-previous"]'),next=document.querySelector('[data-af-id="dataset-next"]'),refresh=document.querySelector('[data-af-id="dataset-refresh"]');
let current=null,history=[],ticket=0;
const cell=(tag,text)=>{const node=document.createElement(tag);node.textContent=text===null?'':String(text);return node;};
async function load(offset=0){const attempt=++ticket;previous.disabled=true;next.disabled=true;refresh.disabled=true;grid.replaceChildren();status.textContent='Loading data…';try{const data=await reader.read(Number(select.value),offset);if(attempt!==ticket)return;current={offset:data.offset,nextOffset:data.nextOffset};const head=document.createElement('thead'),tr=document.createElement('tr');for(const column of data.columns){const th=cell('th',column.name);th.scope='col';tr.append(th);}head.append(tr);const body=document.createElement('tbody');for(const row of data.rows){const tr=document.createElement('tr');for(const column of data.columns)tr.append(cell('td',row[column.name]));body.append(tr);}grid.append(head,body);status.textContent=data.rows.length?('Rows '+(data.offset+1)+'–'+(data.offset+data.rows.length)):'No rows';previous.disabled=history.length===0;next.disabled=data.nextOffset===null||data.nextOffset>1000000;}catch{if(attempt!==ticket)return;current=null;history=[];status.textContent='Dataset read unavailable. Refresh to try again.';}finally{if(attempt===ticket)refresh.disabled=false;}}
next.addEventListener('click',()=>{if(!current||current.nextOffset===null)return;history.push(current.offset);void load(current.nextOffset);});previous.addEventListener('click',()=>{const offset=history.pop();if(offset!==undefined)void load(offset);});const restart=()=>{history=[];current=null;void load();};select.addEventListener('change',restart);refresh.addEventListener('click',restart);void load();
</script></body></html>`;
}
