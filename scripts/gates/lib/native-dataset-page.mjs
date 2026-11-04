/** Native author fixture: persistent viewer selections use Apollo only.
 * Shared rows are read from the link's generated API (`data`), every page of 100 until a short one.
 */
import { pageHtml } from "../../fixtures/page-speed/native.mjs";
/** @param {(query:string, variables?:object)=>Promise<any>} query @param {string[]} columns the link's generated column names */
export async function readDataset(query, columns) {
  const rows = [];
  for (let offset = 0; ; offset += 100) {
    const page = (await query("query($offset:Int!){data(limit:100,offset:$offset){_id " + columns.join(" ") + "}}", { offset })).data;
    if (offset && page.length && page[0]._id === rows[offset - 100]?._id) throw Error("Dataset offset did not advance");
    rows.push(...page);
    if (page.length < 100) break;
  }
  return { columns, rows };
}
export function datasetPageHtml(datasetId, { title = "Live data", mode = "live", revision, writable = true, columns = ["choice"] } = {}) {
  const body = `<link rel="af-dataset" data-af-name="data" href="ref:${datasetId}" data-af-mode="${mode}"${revision ? ` data-af-revision="${revision}"` : ""}>
<h1 id="heading">${title}</h1><label>Choice <select id="choice"><option>ramen</option><option>tacos</option><option>salad</option></select></label>
<button id="vote"${writable ? "" : " disabled"}>Vote</button><button id="refresh">Refresh</button><output id="receipt" role="status"></output><p id="total"></p><div id="tally"></div><svg id="chart" role="img" aria-label="Numeric data" viewBox="0 0 500 220"></svg><table><thead></thead><tbody></tbody></table>`;
  return pageHtml(title, body, `import {onResolverChange} from '@afbin/apollo';
const columns=${JSON.stringify(columns)};
const readDataset=${readDataset.toString()};
const state=gql\`{choice}\`;let current;
const query=async(text,variables)=>{const result=await client.query({query:gql(Object.assign([text],{raw:[text]})),variables});if(result.errors?.length)throw Error(result.errors.map(e=>e.message).join('; '));return result.data};
function shown(v){return v===null||v===undefined?'NULL':typeof v==='object'?JSON.stringify(v):String(v)}
async function refresh(){try{current=await readDataset(query,columns);document.querySelector('#total').textContent='rows: '+current.rows.length;
const totals=new Map();if(columns.includes('choice'))for(const row of current.rows)totals.set(row.choice,(totals.get(row.choice)||0)+1);document.querySelector('#tally').replaceChildren(...[...totals].map(([choice,count])=>{const p=document.createElement('p');p.textContent=choice+' '+count;return p}));
const numeric=columns.find(c=>current.rows.some(row=>typeof row[c]==='number'));const chart=document.querySelector('#chart');chart.replaceChildren();if(numeric){const values=current.rows.map(row=>Number(row[numeric])||0),maximum=Math.max(1,...values);for(let i=0;i<values.length;i++){const bar=document.createElementNS('http://www.w3.org/2000/svg','rect');bar.setAttribute('x',String(i*500/values.length));bar.setAttribute('width',String(450/values.length));bar.setAttribute('height',String(180*values[i]/maximum));bar.setAttribute('y',String(180-180*values[i]/maximum));bar.setAttribute('fill','#337da8');bar.dataset.value=String(values[i]);chart.append(bar)}const label=document.createElementNS('http://www.w3.org/2000/svg','text');label.setAttribute('y','210');label.textContent=numeric+' max '+maximum;chart.append(label)}
const head=document.createElement('tr');for(const c of columns){const th=document.createElement('th');th.textContent=c;head.append(th)}document.querySelector('thead').replaceChildren(head);document.querySelector('tbody').replaceChildren(...current.rows.map(row=>{const tr=document.createElement('tr');tr.dataset.rowId=row._id;for(const c of columns){const td=document.createElement('td');td.textContent=shown(row[c]);tr.append(td)}return tr}));document.documentElement.dataset.afReady='yes';}catch(error){document.querySelector('#receipt').textContent=error.message;throw error}}
client.watchQuery({query:state}).subscribe(({data})=>{document.querySelector('#choice').value=data.choice});
document.querySelector('#choice').onchange=event=>client.updateQuery({query:state},()=>({choice:event.target.value}));
document.querySelector('#refresh').onclick=()=>refresh().catch(()=>{});
document.querySelector('#vote').onclick=async()=>{document.querySelector('#receipt').textContent='';try{const {data}=await client.query({query:state});const result=await client.mutate({mutation:gql\`mutation($choice:String){insert_data(objects:[{choice:$choice}]){affected_rows}}\`,variables:{choice:data.choice}});if(result.errors?.length)throw Error(result.errors.map(e=>e.message).join('; '));const outcome=result.extensions?.outcomes?.insert_data??'unknown';document.querySelector('#receipt').textContent=outcome;if(outcome==='committed')await refresh();}catch(error){document.querySelector('#receipt').textContent='Write refused: '+error.message}};
onResolverChange(names=>{if(names.includes('data'))void refresh().catch(()=>{})});await refresh();`, { choice: "ramen" });
}
