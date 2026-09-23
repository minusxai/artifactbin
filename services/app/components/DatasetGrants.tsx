import type { DatasetAction, DatasetGrant, DatasetGrantPolicy, DatasetGrantSelector } from '@artifactbin/contracts';
import { Button } from './ui';
const actions:DatasetAction[]=['read','insert','update','delete'];
const presets:Array<{label:string;description:string;grant:DatasetGrant}>=[
 {label:'Public reads',description:'Anyone can read this dataset, including forked artefacts. Private sharing still limits access.',grant:{actions:['read'],from:{user:'*'}}},
 {label:"Owner’s artefacts can change data",description:'Accepted members can run saved actions in artefacts owned by this dataset’s owner.',grant:{actions:['insert','update','delete'],from:{artifactOwner:'$owner'}}},
];
const same=(a:DatasetGrant,b:DatasetGrant)=>a.actions.length===b.actions.length&&a.actions.every(action=>b.actions.includes(action))&&(['user','artifact','artifactOwner'] as const).every(key=>a.from[key]===b.from[key]);
const input='w-full rounded-lg border border-edge bg-surface px-3 py-2 text-sm';
export function DatasetGrants({value,onChange,people=[],artifacts=[]}:{people?:Array<{user_id:string;username:string|null;name:string|null}>;artifacts?:Array<{id:string;title:string|null}>;value:DatasetGrantPolicy;onChange:(v:DatasetGrantPolicy)=>void}){
 const replace=(i:number,g:DatasetGrant)=>onChange({...value,allow:value.allow.map((old,n)=>i===n?g:old)});
 return <section aria-label="Dataset grants" className="space-y-4">
  <div className="divide-y divide-edge rounded-xl border border-edge bg-surface">{presets.map(p=><label key={p.label} className="flex cursor-pointer items-start gap-3 p-4">
   <input type="checkbox" className="mt-1 accent-accent" aria-label={p.label} checked={value.allow.some(g=>same(g,p.grant))} onChange={e=>onChange({...value,allow:e.target.checked?[...value.allow,p.grant]:value.allow.filter(g=>!same(g,p.grant))})}/>
   <span><span className="block font-medium">{p.label}</span><span className="mt-1 block text-xs leading-5 text-muted">{p.description}</span></span>
  </label>)}</div>
  {value.allow.map((grant,i)=>presets.some(p=>same(p.grant,grant))?null:<fieldset key={i} className="space-y-3 rounded-xl border border-edge p-4">
   <legend className="px-1 text-xs text-muted">Allow rule {i+1}</legend>
   <div className="flex flex-wrap gap-4">{actions.map(action=><label key={action} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={grant.actions.includes(action)} onChange={e=>replace(i,{...grant,actions:e.target.checked?[...grant.actions,action]:grant.actions.filter(a=>a!==action)})}/>{action}</label>)}</div>
   {(['user','artifact','artifactOwner'] as const).map(key=><div key={key} className="grid gap-2 sm:grid-cols-2">
    <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={grant.from[key]!==undefined} onChange={e=>{const from:DatasetGrantSelector={...grant.from};if(e.target.checked)from[key]='*';else delete from[key];replace(i,{...grant,from});}}/>{key==='user'?'Acting user':key==='artifact'?'Saved artefact':'Artefact owner'}</label>
    {grant.from[key]!==undefined&&<select className={input} aria-label={`Rule ${i+1} ${key}`} value={grant.from[key]} onChange={e=>replace(i,{...grant,from:{...grant.from,[key]:e.target.value}})}>
      <option value="*">{key==='artifact'?'Any artefact':'Anyone'}</option>
      {key!=='artifact'&&<option value="$owner">Dataset owner</option>}
      {key==='artifact'?artifacts.map(a=><option key={a.id} value={a.id}>{a.title??a.id}</option>):people.map(p=><option key={p.user_id} value={p.user_id}>{p.username?`@${p.username}`:p.name??p.user_id}</option>)}
      {grant.from[key]!=='*'&&grant.from[key]!=='$owner'&&!(key==='artifact'?artifacts.some(a=>a.id===grant.from[key]):people.some(p=>p.user_id===grant.from[key]))&&<option value={grant.from[key]}>{grant.from[key]}</option>}
    </select>}
   </div>)}
   <p className="text-xs text-muted">All selected conditions must match. Any allow rule can grant access.</p>
   <Button variant="ghost" onClick={()=>onChange({...value,allow:value.allow.filter((_,n)=>n!==i)})}>Remove rule {i+1}</Button>
  </fieldset>)}
  <Button variant="ghost" onClick={()=>onChange({...value,allow:[...value.allow,{actions:['read'],from:{user:'$owner'}}]})}>Add allow rule</Button>
  {!value.allow.length&&<p className="text-sm text-muted">Locked: no data reads or mutations are allowed. Owners can still manage policies.</p>}
 </section>;
}
