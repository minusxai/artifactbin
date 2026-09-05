/** Generated-edit evaluation, not autonomous MCP completion. No credentials logged. */
import { spawn } from 'node:child_process';
import { startDocument } from './lib/start-doc.mjs';

const base=process.argv[2]??'http://localhost:5200';
if(!['localhost','127.0.0.1'].includes(new URL(base).hostname))throw new Error('local disposable evaluation only');
const source='<main id="root"><Card id="card">Hello</Card><section id="dest"></section><p id="aaaa">active</p><p id="bbbb">active</p><p id="live">Old</p></main>';
const prompt=`Return JSON only, no markdown, tools, files or explanations. We are evaluating four INDEPENDENT atomic JSX edit batches, each starting from the same source below. Return an object with keys move, wrap, dependent, repeated; each value is an array of objects with old_string and new_string strings. Each old_string must match EXACTLY ONCE against the output of the previous step. Intermediate JSX may be invalid; only the final source is validated. Preserve all existing IDs. Use nearest ID context, not the full document. Keep p id=live untouched. Tasks: move: move Card id=card inside section id=dest, with separate deletion/insertion steps. wrap: wrap Card id=card in section id=wrap using separate opening and closing edits so the intermediate JSX is invalid. dependent: insert a p id=added containing Pending inside section id=dest, then a second edit changes that newly inserted Pending to Done. repeated: change only p id=bbbb from active to blocked. Source: ${source}`;
const child=spawn('opencode',['run','--pure','--format','json','--model','fireworks-ai/accounts/fireworks/models/glm-5p3',prompt],{stdio:['ignore','pipe','pipe']});
let stdout='',stderr='';
child.stdout.on('data',d=>{stdout+=d;if(stdout.length>2_000_000)child.kill('SIGTERM');});
child.stderr.on('data',d=>{stderr+=d;if(stderr.length>100_000)stderr=stderr.slice(-100_000);});
const timer=setTimeout(()=>child.kill('SIGTERM'),120_000);
const code=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',resolve);});clearTimeout(timer);
if(code!==0)throw new Error(`model harness exited ${code}; raw stderr withheld`);
const events=stdout.trim().split('\n').flatMap(line=>{try{return [JSON.parse(line)];}catch{return [];}});
const texts=events.filter(e=>e.type==='text').map(e=>e.part?.text??e.text??'');
const answer=texts.join('').trim().replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,'');
let edits;try{edits=JSON.parse(answer);}catch{throw new Error('model answer was not valid JSON');}
const finish=events.filter(e=>e.type==='step_finish');
const cost=finish.reduce((n,e)=>n+(e.part?.cost??0),0);
const doc=await startDocument(base);
const route=`${base}/api/artifacts/${doc.id}`;
async function api(url,method='GET',body){
  const r=await fetch(url,{method,headers:{'Content-Type':'application/json',Authorization:`Bearer ${doc.token}`},body:body===undefined?undefined:JSON.stringify(body)});
  return {status:r.status,body:await r.json()};
}
const results=[];
for(const name of ['move','wrap','dependent','repeated']){
  const seeded=await api(route,'PUT',{markup:source});if(seeded.status!==200)throw new Error('seed failed');
  const initial=(await api(route)).body;
  const concurrent=await api(route+'/edits','POST',{edit_id:initial.edit_id,old_string:'Old',new_string:'Current'});
  if(concurrent.status!==200)throw new Error('concurrent seed failed');
  const applied=await api(route+'/edits','POST',{edit_id:initial.edit_id,edits:edits[name]});
  const current=(await api(route)).body;
  const desired={move:'<section id="dest"><Card id="card">Hello</Card></section>',wrap:'<section id="wrap"><Card id="card">Hello</Card></section>',dependent:'<p id="added">Done</p>',repeated:'<p id="bbbb">blocked</p>'}[name];
  results.push({name,status:applied.status,passed:applied.status===200&&current.markup.includes(desired)&&current.markup.includes('Current'),edits:edits[name],...(applied.status===200?{}:{error:applied.body.error})});
}
console.log(JSON.stringify({harness:'opencode',model:'glm-5p3',kind:'generated batches executed through real HTTP API',cost,results},null,2));
if(results.some(r=>!r.passed))process.exitCode=1;
