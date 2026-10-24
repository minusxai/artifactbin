/** Inert original-source evidence. No git-history, network, or current-source fallback. */
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const root=new URL('./retained-source/',import.meta.url);
const manifest=JSON.parse(readFileSync(new URL('manifest.json',root),'utf8'));
/** @param {{revision:string,path:string,sha256?:string}} proof */
export function retainedComponentSource(proof){
 const entry=manifest.sources.find(source=>source.revision===proof.revision&&source.path===proof.path);
 if(!entry||manifest.format!=='retained-component-source-v1'||!/^[-a-z]+\.source\.txt$/.test(entry.file)||proof.sha256&&proof.sha256!==entry.sha256)throw Error('retained_component_source_unadmitted');
 const source=readFileSync(new URL(entry.file,root),'utf8');
 if(createHash('sha256').update(source).digest('hex')!==entry.sha256)throw Error('retained_component_source_changed');
 return source;
}
