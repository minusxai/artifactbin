/** Author-local drafts and booking state use Apollo; no stored server mutation. */
import { pageHtml } from "../../fixtures/page-speed/native.mjs";
export function localStatePageHtml() {
  return pageHtml("Local draft and booking", `
<h1>Local drafts</h1><label>Choice <select id="choice"><option>a</option><option>b</option></select></label>
<output id="count"></output><output id="rows"></output><p id="branch"></p><ul id="drafts"></ul><button id="add">Add draft</button><button id="open">Open dialog</button>
<dialog><form><label>Note <input id="note" autofocus required></label><button id="save">Save</button><button id="cancel" type="button">Cancel</button></form></dialog>
<h2 id="day"></h2><div id="days">${Array.from({ length: 20 }, (_, i) => `<button data-day="Day ${i + 1}">Day ${i + 1}</button>`).join("")}</div>`, `
const query=gql\`{count open note choice day drafts{id label}}\`;
client.watchQuery({query}).subscribe(({data})=>{
 document.querySelector('#count').textContent=String(data.count);document.querySelector('#rows').textContent=String(data.drafts.length);document.querySelector('#choice').value=data.choice;document.querySelector('#branch').textContent=data.choice==='b'?'bee':'aye';document.querySelector('#day').textContent=data.day;
 document.querySelector('#drafts').replaceChildren(...data.drafts.map(row=>{const li=document.createElement('li');li.textContent=row.label;li.dataset.afId='draft-'+row.id;return li}));
 const dialog=document.querySelector('dialog');document.querySelector('#note').value=data.note;if(data.open&&!dialog.open)dialog.showModal();if(!data.open&&dialog.open)dialog.close();
});
const change=fn=>client.updateQuery({query},fn);
document.querySelector('#choice').onchange=event=>change(data=>({...data,choice:event.target.value}));
document.querySelector('#open').onclick=()=>change(data=>({...data,open:true}));
document.querySelector('#cancel').onclick=()=>change(data=>({...data,open:false}));
document.querySelector('dialog').oncancel=event=>{event.preventDefault();void change(data=>({...data,open:false}))};
document.querySelector('#note').oninput=event=>change(data=>({...data,note:event.target.value}));
const add=close=>change(data=>({...data,count:data.count+1,open:close?false:data.open,drafts:[...data.drafts,{id:data.drafts.length+1,label:data.note}]}));
document.querySelector('#add').onclick=()=>add(false);document.querySelector('form').onsubmit=event=>{event.preventDefault();void add(true)};
for(const button of document.querySelectorAll('[data-day]'))button.onclick=()=>change(data=>({...data,day:button.dataset.day}));
document.documentElement.dataset.afReady='yes';`, { count: 0, open: false, note: "draft", choice: "a", day: "Day 1", drafts: [{ id: 1, label: "first" }] });
}
