import type { StatePort } from './apollo/apollo-contracts';
interface HtmlCommentViewOptions { declaration: {version:string; fields:readonly string[]}; state:StatePort; backends:readonly string[] }
import { parseCommentViewState, type ReviewJson } from '../../../contracts/src/comment-view-state';
import type { HtmlCommentViewPort } from '../html-bridge';
const safe = (key: string) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) && key.length <= 128 && !['__proto__','prototype','constructor'].includes(key);
/** Explicit UI projection only: no query or mutation can reach a backend. */
export function createHtmlCommentView({declaration,state,backends}: HtmlCommentViewOptions): HtmlCommentViewPort {
 const {version,fields}=declaration;
 if (!version || version.length>128 || !fields.length || fields.length>256 || new Set(fields).size!==fields.length || fields.some(key=>!safe(key)||backends.includes(key))) throw new Error('Invalid comment view declaration.');
 const capture = () => {
  const current=state.read(); const values:Record<string,ReviewJson>={};
  for(const key of fields) { if(!Object.hasOwn(current,key)) throw new Error('A declared view field is missing.'); values[key]=current[key]!; }
  const saved=parseCommentViewState({v:2,state:{$html:{version,fields:values}}});
  if(!saved) throw new Error('Comment view exceeds bounded JSON limits.');
  return saved;
 };
 return {capture, async restore(input) {
  const saved=parseCommentViewState(input);
  const block=saved?.state.$html;
  if(!saved || Object.keys(saved.state).length!==1 || !block || typeof block!=='object' || Array.isArray(block) || block.version!==version || Object.keys(block).sort().join(',')!=='fields,version') throw new Error('Saved view version is incompatible.');
  const values=block.fields;
  if(!values || typeof values!=='object' || Array.isArray(values) || Object.keys(values).length!==fields.length || fields.some(key=>!Object.hasOwn(values,key))) throw new Error('Saved view fields are incompatible.');
  const current=state.read();
  const expected:Record<string,ReviewJson|undefined>={}; const next:Record<string,ReviewJson>={};
  for(const key of fields){expected[key]=current[key]; next[key]=values[key]!;}
  const result=await state.write({expected,next});
  if(result.status!=='committed')throw new Error('The current view changed. Try restoring again.');
 }};
}
