/** A one-time local onramp. JSX owns identity and editing after conversion. */
import {Marked} from 'marked';
import {extname,relative,resolve} from 'node:path';
import {CliError} from './commands';
import {parseDocument,writeDocument} from './document';
import {digest,readOptional} from './files';
import {confinedPath,recoverFiles,stageFiles} from './journal';
import {withLock,type State} from './state';
import {readState,stateFor} from './state-access';
import type {Workspace} from './workspace';
const text=(source:string,literal=false)=>source.replace(literal?/&/g:/&(?!(?:#\d+|#x[\da-f]+|[a-z][a-z\d]+);)/gi,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\{/g,'&#123;').replace(/\}/g,'&#125;');
const attribute=(value:string)=>text(value,true).replace(/"/g,'&quot;');
function address(value:string):string{
 if(/^[a-z][a-z\d+.-]*:/i.test(value)&&! /^(https?:|mailto:|ref:)/i.test(value))throw new CliError('unsupported_markdown','Unsupported Markdown link protocol.','Use an HTTPS URL, relative path or ref:<id>.');
 return attribute(value);
}
const renderer=new Marked({gfm:true,async:false,renderer:{
 html(){throw new CliError('unsupported_markdown','Raw HTML and JSX in Markdown are unsupported.','Write a .jsx document for components or HTML authoring.');},
 checkbox(){throw new CliError('unsupported_markdown','Markdown task checkboxes are unsupported.','Use an ordinary list, or author the interaction in .jsx.');},
 text(token){return 'tokens'in token&&token.tokens?this.parser.parseInline(token.tokens):text(token.text);},
 codespan(token){return `<code>${text(token.text,true)}</code>`;},
 code(token){return `<pre><code>${text(token.text,true)}</code></pre>\n`;},
 image(token){return `<img src="${address(token.href)}" alt="${attribute(token.text)}"${token.title?` title="${attribute(token.title)}"`:''} />`;},
 link(token){return `<a href="${address(token.href)}"${token.title?` title="${attribute(token.title)}"`:''}>${this.parser.parseInline(token.tokens)}</a>`;},
 br(){return '<br />';},hr(){return '<hr />\n';},
}});
export function convertMarkdown(source:string):string{
 const document=parseDocument(source);
 if(document.metadata.id)throw new CliError('unsupported_markdown','Markdown import cannot carry a published identity.','Pull the artifact as .jsx and edit that file.');
 const body=renderer.parse(document.body) as string;
 return writeDocument({metadata:document.metadata,body:`<article>\n${body}</article>\n`});
}
interface Conversion {source:string;target:string;before:string;bytes:Buffer}
export interface MarkdownPlan {workspace:Workspace;paths:string[];conversions:Conversion[]}
type ConversionEntry={target:string;sha256:string};
/**
 * What has already been converted in this workspace: one `conversion` record per
 * Markdown path in the state store. A read never creates the store, so a
 * workspace nothing was imported into simply has no records.
 */
async function conversionRecord(state:State|null,root:string):Promise<Record<string,ConversionEntry>>{
 if(!state)return{};
 const records:Record<string,ConversionEntry>={};
 for(const record of state.list<ConversionEntry>(root,'conversion')){
  const value=record.value;
  if(!value||typeof value.target!=='string'||typeof value.sha256!=='string')throw new CliError('invalid_conversion_record','A Markdown conversion record in the state store is invalid.',`Repair or remove the conversion records in ${state.path} before importing Markdown.`);
  records[record.key]=value;
 }
 return records;
}
/**
 * `stageFiles` still journals through a directory inside the workspace; once the
 * journal has been applied the empty directory goes too, so importing Markdown
 * leaves the user's files and nothing else. This disappears with the file
 * journal itself, when staged files become `staged-file` records.
 */
export async function prepareMarkdown(workspace:Workspace,paths:string[]):Promise<MarkdownPlan>{
 const conversions:Conversion[]=[],selected:string[]=[];const virtualFiles={...workspace.virtualFiles};
 const state=paths.some(path=>['.md','.markdown'].includes(extname(path).toLowerCase()))?await readState(workspace.home):null;
 const records=await conversionRecord(state,workspace.root);
 for(const path of paths){
  if(!['.md','.markdown'].includes(extname(path).toLowerCase())){selected.push(path);continue;}
  const absolute=await confinedPath(workspace.root,resolve(workspace.cwd,path)),source=relative(workspace.root,absolute);
  const target=source.slice(0,-extname(source).length)+'.jsx';
  if(records[source])throw new CliError('markdown_already_converted',`${source} was already converted; edit ${records[source].target}.`,`Run afbin push ${records[source].target}.`);
  const destination=await confinedPath(workspace.root,target);
  if(await readOptional(destination))throw new CliError('conversion_target_exists',`${target} already exists; it was not overwritten.`,`Edit and push ${target}, or choose a different Markdown filename.`);
  if(conversions.some(x=>x.target===target))throw new CliError('conversion_target_exists',`Multiple Markdown files select ${target}.`);
  const bytes=await readOptional(absolute);if(!bytes)throw new CliError('missing_file',`Missing ${source}.`);
  const converted=Buffer.from(convertMarkdown(bytes.toString()));conversions.push({source,target,before:digest(bytes),bytes:converted});virtualFiles[target]=converted;selected.push(relative(workspace.cwd,destination));
 }
 return{workspace:{...workspace,virtualFiles},paths:selected,conversions};
}
export async function commitMarkdown(plan:MarkdownPlan):Promise<void>{
 if(!plan.conversions.length)return;
 const root=plan.workspace.root;
 await withLock(plan.workspace.home,root,async()=>{
  const state=await stateFor(plan.workspace.home);
  {
   const records=await conversionRecord(state,root);
   for(const item of plan.conversions){
    const current=await readOptional(await confinedPath(root,item.source));
    if(!current||digest(current)!==item.before)throw new CliError('local_changed',`${item.source} changed during Markdown conversion; no JSX was written.`);
    if(records[item.source]||await readOptional(await confinedPath(root,item.target)))throw new CliError('conversion_target_exists',`Conversion destination ${item.target} already exists.`);
   }
   await stageFiles(plan.workspace.home,root,plan.conversions.map(item=>({path:item.target,before:null,data:item.bytes})));
   state.transaction(()=>{for(const item of plan.conversions)state.put(root,'conversion',item.source,{target:item.target,sha256:item.before});});
   await recoverFiles(plan.workspace.home,root);
   
  }
 });
}
