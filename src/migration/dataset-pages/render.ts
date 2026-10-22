import { renderExternalDatasetPage } from "./external-render.ts";
import type { StandaloneDatasetPagePlan } from "./contracts.ts";
import { createDatasetPageReader } from "./reader.ts";
const escape = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
const json = (v: unknown) => JSON.stringify(v).replace(/</g, "\\u003c");
/** No rows, original policies, connector addresses or SQL are emitted into page source. */
export function renderStandaloneDatasetPage(
  plan: StandaloneDatasetPagePlan,
): string {
  if (plan.kind === "external-ready") return renderExternalDatasetPage(plan);
  const ready = plan.kind === "ready";
  const body = ready
    ? `<label for="dataset-table">Table</label><select data-af-id="dataset-table" id="dataset-table">${plan.binding.tables.map((t, i) => `<option value="${i}">${escape(t.schema + "." + t.table)}</option>`).join("")}</select><p data-af-id="dataset-status" role="status" aria-live="polite">Loading data…</p><div class="table-scroll"><table data-af-id="dataset-grid"><thead></thead><tbody></tbody></table></div><nav aria-label="Table pages"><button data-af-id="dataset-previous" disabled>Previous</button><button data-af-id="dataset-next" disabled>Next</button><button data-af-id="dataset-refresh">Refresh</button></nav>`
    : `<p role="status">This dataset’s external connection has not been registered. Its rows are unavailable.</p>`;
  const script = ready
    ? `<script type="module">
import {gql,client} from '@afbin/apollo';
const binding=${json({ name: plan.binding.name, backendNamespace: plan.binding.backendNamespace, mode: plan.binding.mode, version: plan.binding.version, tables: plan.binding.tables.map((t) => ({ schema: t.schema, table: t.table, columns: t.columns.map((c) => ({ name: c.name, type: c.type })) })) })},makeReader=${createDatasetPageReader.toString()};
const query=gql\`query DatasetPageRead($binding:String!,$schema:String!,$table:String!,$offset:Int!,$limit:Int!,$expectedVersion:Int,$expectedGeneration:Int){${plan.binding.backendNamespace}{read(binding:$binding,schema:$schema,table:$table,offset:$offset,limit:$limit,expectedVersion:$expectedVersion,expectedGeneration:$expectedGeneration){version generation schema table columns{name type} rows offset nextOffset totalRows}}}\`;
const reader=makeReader(binding,async(namespace,variables)=>{const result=await client.query({query,variables,fetchPolicy:'network-only'});if(result.errors?.length||!result.data?.[namespace]?.read)throw Error();return result.data[namespace].read;});
const select=document.querySelector('#dataset-table'),grid=document.querySelector('[data-af-id="dataset-grid"]'),status=document.querySelector('[data-af-id="dataset-status"]'),previous=document.querySelector('[data-af-id="dataset-previous"]'),next=document.querySelector('[data-af-id="dataset-next"]'),refresh=document.querySelector('[data-af-id="dataset-refresh"]');
let current=null,history=[],ticket=0;
const cell=(tag,text)=>{const node=document.createElement(tag);node.textContent=text===null?'':String(text);return node;};
async function load(offset=0,prior){const attempt=++ticket;previous.disabled=true;next.disabled=true;refresh.disabled=true;grid.replaceChildren();status.textContent='Loading data…';try{const data=await reader.read(Number(select.value),offset,prior);if(attempt!==ticket)return;current=data;const head=document.createElement('thead'),tr=document.createElement('tr');for(const column of data.columns){const th=cell('th',column.name);th.scope='col';tr.append(th);}head.append(tr);const body=document.createElement('tbody');for(const row of data.rows){const tr=document.createElement('tr');for(const column of data.columns)tr.append(cell('td',row[column.name]));body.append(tr);}grid.append(head,body);status.textContent=data.totalRows?('Rows '+(data.offset+1)+'–'+(data.offset+data.rows.length)+' of '+data.totalRows):'No rows';previous.disabled=history.length===0;next.disabled=data.nextOffset===null;}catch{if(attempt!==ticket)return;current=null;history=[];status.textContent='Dataset read unavailable. Refresh to try again.';}finally{if(attempt===ticket)refresh.disabled=false;}}
next.addEventListener('click',()=>{if(!current||current.nextOffset===null)return;history.push({version:current.version,generation:current.generation,schema:current.schema,table:current.table,offset:current.offset,nextOffset:current.nextOffset,totalRows:current.totalRows});void load(current.nextOffset,current);});
previous.addEventListener('click',()=>{const target=history.pop();if(!target)return;const prior=history.at(-1);void load(target.offset,prior);});
const restart=()=>{history=[];current=null;void load();};select.addEventListener('change',restart);refresh.addEventListener('click',restart);void load();
</script>`
    : "";
  return `<!doctype html><html lang="en" data-af-design-system="signout"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(plan.title)}</title><script data-af="core" src="${escape(plan.coreUrl)}"></script>${ready ? `<link rel="af-backend" data-af-name="${escape(plan.binding.backendNamespace)}" href="${escape(plan.binding.backendHref)}">` : ""}<style>body{margin:0;background:var(--background,#fff);color:var(--foreground,#17202a);font:1rem/1.5 system-ui,sans-serif}main{max-width:80rem;margin:auto;padding:2rem}h1{overflow-wrap:anywhere}select,button{font:inherit;padding:.5rem}nav{display:flex;gap:.75rem;margin-top:1rem}.table-scroll{overflow:auto}table{border-collapse:collapse;width:100%}th,td{text-align:left;vertical-align:top;border-bottom:1px solid var(--border,#ddd);padding:.5rem;max-width:30rem;overflow-wrap:anywhere}th{background:var(--muted,#f6f8fa)}</style></head><body><main><h1>${escape(plan.title)}</h1>${body}</main>${script}</body></html>`;
}
