/** Native per-row drafts keep the values they were edited from until explicit discard. A save updates the row only
 * while it still holds those values (a conditional `update_data`): a conflict changes nothing, never retries and
 * never loses intent. */
import { pageHtml } from "../../fixtures/page-speed/native.mjs";
import { readDataset } from "./native-dataset-page.mjs";
const COLUMNS = [{ name: "id", key: true }, { name: "item", type: "string" }, { name: "hours", type: "number" }, { name: "done", type: "boolean" }, { name: "tags", type: "string" }];
export function editableDatasetPageHtml(datasetId, columns = COLUMNS) {
  return pageHtml("Editable native dataset", `
<link rel="af-dataset" data-af-name="data" href="ref:${datasetId}"><h1>Editable native dataset</h1>
<button id="discard">Discard drafts and reload</button><output id="receipt" role="status"></output><p id="total"></p>
<div style="max-width:100%;overflow:auto"><table><thead></thead><tbody></tbody></table></div>`, `
import {onBackendChange} from '@afbin/apollo';const readDataset=${readDataset.toString()};
const columns=${JSON.stringify(columns)};const key=columns.find(column=>column.key);
const state=gql\`{edits}\`;let current;
const query=async(text,variables)=>{const result=await client.query({query:gql(Object.assign([text],{raw:[text]})),variables});if(result.errors?.length)throw Error(result.errors.map(error=>error.message).join('; '));return result.data};
const read=(column,input)=>column.type==='number'?(input.value===''?null:Number(input.value)):column.type==='boolean'?input.checked:input.value;
async function draft(row,column,input){const value=read(column,input);await client.updateQuery({query:state},({edits})=>{const edit=edits[row._id]??{observed:{},values:{}};return {edits:{...edits,[row._id]:{observed:{...edit.observed,...(column.name in edit.observed?{}:{[column.name]:row[column.name]??null})},values:{...edit.values,[column.name]:value}}}}})}
async function save(row){document.querySelector('#receipt').textContent='';const {data}=await client.query({query:state});const edit=data.edits[row._id];if(!edit)return;
 const where={_and:[{_id:{_eq:row._id}},...Object.entries(edit.observed).map(([name,value])=>value===null?{[name]:{_is_null:true}}:{[name]:{_eq:value}})]};
 try{const result=await client.mutate({mutation:gql\`mutation($where:data_bool_exp!,$set:data_set_input!){update_data(where:$where,_set:$set){affected_rows}}\`,variables:{where,set:edit.values}});if(result.errors?.length)throw Error(result.errors.map(error=>error.message).join('; '));
 const committed=result.extensions?.outcomes?.update_data??'unknown',outcome=committed==='committed'&&result.data?.update_data?.affected_rows===0?'rejected':committed;document.querySelector('#receipt').textContent=outcome;
 if(outcome==='committed'){await client.updateQuery({query:state},({edits})=>{const next={...edits};delete next[row._id];return {edits:next}});await refresh()}}catch(error){document.querySelector('#receipt').textContent='Write refused: '+error.message}}
async function refresh(){try{const next=await readDataset(query,columns.map(column=>column.name));current=next;document.querySelector('#total').textContent=String(current.rows.length);if(document.activeElement?.matches('input,textarea'))return;const {data}=await client.query({query:state});const header=document.createElement('tr');for(const column of columns){const th=document.createElement('th');th.textContent=column.name;header.append(th)}document.querySelector('thead').replaceChildren(header);
 document.querySelector('tbody').replaceChildren(...current.rows.map(row=>{const tr=document.createElement('tr');tr.dataset.rowId=row._id;tr.dataset.afId='row-'+row._id;const label=key?row[key.name]??row._id:row._id;for(const column of columns){const td=document.createElement('td');const edits=data.edits[row._id]?.values??{};const v=column.name in edits?edits[column.name]:row[column.name]??null;if(column===key){td.textContent=String(v)}else{const input=document.createElement('input');input.setAttribute('aria-label',column.name+' '+label);input.dataset.afId='cell-'+row._id+'-'+column.name;if(column.type==='boolean'){input.type='checkbox';input.checked=Boolean(v)}else{if(column.type==='number')input.type='number';input.value=v===null?'':String(v)}input.oninput=()=>draft(row,column,input).catch(error=>document.querySelector('#receipt').textContent=error.message);td.append(input)}tr.append(td)}const action=document.createElement('td');const button=document.createElement('button');button.textContent='Save '+label;button.onclick=()=>save(row);action.append(button);tr.append(action);return tr}));document.documentElement.dataset.afReady='yes';}catch(error){document.querySelector('#receipt').textContent=error.message;throw error}}
document.querySelector('#discard').onclick=async()=>{await client.updateQuery({query:state},()=>({edits:{}}));await refresh()};onBackendChange(names=>{if(names.includes('data'))void refresh().catch(()=>{})});await refresh();`, { edits: {} });
}
