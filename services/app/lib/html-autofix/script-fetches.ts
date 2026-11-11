/**
 * The paths a script fetches by a literal: `fetch('./data.json')`, `fetch("x.json", init)`, `` fetch(`b.json`) `` with no
 * substitution, `window.fetch(…)` alike. Read from the script's tokens, so comments and other strings never count; a
 * script that does not tokenize gives what precedes its error. Publish carries the project file each names
 * (lib/html-publication-bundle plan, the skill's snapshot in preview-html.mjs) and the page's core maps the path to it
 * (lib/html-runtime fn-fetch); autofix warns about a file a script names any other way. A fetch resolves against the
 * document, never the file the call is in, so each path is the page's.
 */
import {tokenizer,tokTypes as tt,type Token as AcornToken} from 'acorn';
/** acorn's tokens carry their literal value, which its declared type omits. */
type Token=AcornToken&{value?:unknown};

export function scriptFetchPaths(source:string,module=true):string[]{
 const tokens:Token[]=[];
 try{for(const token of tokenizer(source,{ecmaVersion:'latest',sourceType:module?'module':'script',allowAwaitOutsideFunction:true,allowHashBang:true,allowReturnOutsideFunction:true}))tokens.push(token);}
 catch{/* a script that does not tokenize: what it fetched before the error */}
 const paths:string[]=[],ends=(token:Token|undefined)=>token?.type===tt.comma||token?.type===tt.parenR;
 for(let at=0;at<tokens.length-3;at++){
  if(tokens[at]!.type!==tt.name||tokens[at]!.value!=='fetch'||tokens[at+1]!.type!==tt.parenL)continue;
  const first=tokens[at+2]!;
  if(first.type===tt.string&&ends(tokens[at+3]))paths.push(first.value as string);
  else if(first.type===tt.backQuote&&tokens[at+3]?.type===tt.template&&tokens[at+4]?.type===tt.backQuote&&ends(tokens[at+5]))paths.push(tokens[at+3]!.value as string);
 }
 return paths;
}
