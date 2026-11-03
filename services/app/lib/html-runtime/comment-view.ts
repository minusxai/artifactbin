import type { StatePort } from './apollo/apollo-contracts';
/** `partial`: the default (undeclared) view, which saves what fits and restores any non-empty subset of its fields. */
interface HtmlCommentViewDeclaration { version:string; fields:readonly string[]; partial?:boolean }
interface HtmlCommentViewOptions { declaration: HtmlCommentViewDeclaration; state:StatePort; backends:readonly string[] }
import { derivedCommentViewVersion, parseCommentViewFieldList, parseCommentViewState, type ReviewJson } from '../../../contracts/src/comment-view-state';
import type { HtmlCommentViewPort } from '../html-bridge';
const safe = (key: string) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) && key.length <= 128 && !['__proto__','prototype','constructor'].includes(key);
const list = (text: string) => { const names = parseCommentViewFieldList(text); if (typeof names === 'string') throw new Error('Invalid comment view field list.'); return names; };

/** The state block's view declaration. Explicit `data-af-comment-fields` win; without them every authored top-level field
 * is saved, minus `data-af-comment-exclude` and backend namespaces. Undefined: nothing to save. Throws when invalid. */
export function commentViewDeclaration(block:{initial:Record<string,unknown>; attribute(name:string):string|null}, backends:readonly string[]): HtmlCommentViewDeclaration|undefined {
 const declared=block.attribute('data-af-comment-fields'), version=block.attribute('data-af-comment-version');
 if(declared!==null){ const fields=list(declared); return {version:version??derivedCommentViewVersion(fields),fields}; }
 const exclude=new Set(list(block.attribute('data-af-comment-exclude')??'[]'));
 const fields=Object.keys(block.initial).filter(key=>safe(key)&&!exclude.has(key)&&!backends.includes(key));
 return fields.length ? {version:version??derivedCommentViewVersion(fields),fields,partial:true} : undefined;
}

const snapshot=(version:string,fields:Record<string,ReviewJson>)=>parseCommentViewState({v:2,state:{$html:{version,fields}}});
/** Explicit UI projection only: no query or mutation can reach a backend. */
export function createHtmlCommentView({declaration,state,backends}: HtmlCommentViewOptions): HtmlCommentViewPort {
 const {version,fields,partial}=declaration;
 if (!version || version.length>128 || !fields.length || fields.length>256 || new Set(fields).size!==fields.length || fields.some(key=>!safe(key)||backends.includes(key))) throw new Error('Invalid comment view declaration.');
 const capture = () => {
  const current=state.read(); const values:Record<string,ReviewJson>={};
  if(partial) {
   // Keep the most fields that fit the bounds, smallest first; a reader's comment never fails for an oversized view.
   const size=(key:string)=>JSON.stringify(current[key]??null).length;
   const kept=new Set<string>();
   for(const key of fields.filter(key=>Object.hasOwn(current,key)).sort((a,b)=>size(a)-size(b)||(a<b?-1:1))) {
    const trial:Record<string,ReviewJson>={};
    for(const name of [...kept,key])trial[name]=current[name]!;
    if(snapshot(version,trial))kept.add(key);
   }
   for(const key of fields)if(kept.has(key))values[key]=current[key]!;
   return kept.size ? snapshot(version,values) : null;
  }
  for(const key of fields) { if(!Object.hasOwn(current,key)) throw new Error('A declared view field is missing.'); values[key]=current[key]!; }
  const saved=snapshot(version,values);
  if(!saved) throw new Error('Comment view exceeds bounded JSON limits.');
  return saved;
 };
 return {capture, async restore(input) {
  const saved=parseCommentViewState(input);
  const block=saved?.state.$html;
  if(!saved || Object.keys(saved.state).length!==1 || !block || typeof block!=='object' || Array.isArray(block) || block.version!==version || Object.keys(block).sort().join(',')!=='fields,version') throw new Error('Saved view version is incompatible.');
  const values=block.fields;
  if(!values || typeof values!=='object' || Array.isArray(values)) throw new Error('Saved view fields are incompatible.');
  const keys=Object.keys(values);
  const compatible=partial ? keys.length>0 && keys.every(key=>fields.includes(key)) : keys.length===fields.length && fields.every(key=>Object.hasOwn(values,key));
  if(!compatible) throw new Error('Saved view fields are incompatible.');
  const current=state.read();
  const expected:Record<string,ReviewJson|undefined>={}; const next:Record<string,ReviewJson>={};
  for(const key of keys){expected[key]=current[key]; next[key]=values[key]!;}
  const result=await state.write({expected,next});
  if(result.status!=='committed')throw new Error('The current view changed. Try restoring again.');
 }};
}
