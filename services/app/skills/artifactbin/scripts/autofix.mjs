/** The autofix pass for one HTML file (rules: lib/html-autofix). publish.mjs and serve.mjs run the same pass themselves. */
import path from 'node:path';
import {statSync} from 'node:fs';
import {readFile,writeFile,rename,realpath} from 'node:fs/promises';
import {autofixHtml,formatAutofixReport} from './preview-html.mjs';
import {runTool,positional,ToolError,within} from './toolbox-client.mjs';
/** A local reference exists when it is a file inside the project root, or a dependency the baseline already published (`mapped`, root-relative). */
export function localExists(file,root,mapped=()=>false){
 const directory=path.dirname(file);
 return relative=>{const full=path.resolve(directory,relative);if(mapped(path.relative(root,full).split(path.sep).join('/')))return true;if(!within(root,full))return false;try{return statSync(full).isFile();}catch{return false;}};
}
export function autofixSource(source,{file,root,mapped}){return autofixHtml(source,{exists:localExists(file,root??path.dirname(file),mapped)});}
/** Full detail for --json and saved results; the printed report is capped. */
export const autofixDetail=(result,report)=>({clean:!result.fixes.length&&!result.problems.length,fixes:result.fixes,problems:result.problems,routine:result.routine,...(report?{report}:{})});
export async function replaceFile(file,text){const temporary=`${file}.autofix-${process.pid}.tmp`;await writeFile(temporary,text);await rename(temporary,file);}
/** @param {{values:any,positionals:string[]}} parsed @param {{log?:(text:string)=>void}} [options] */
export async function autofixCommand({values,positionals},{log=text=>process.stdout.write(text)}={}){
 const file=await realpath(positional(positionals));
 if(!/\.html?$/i.test(file))throw new ToolError('not_html','autofix checks HTML pages only.',2);
 const root=await realpath(values.root??path.dirname(file));if(!within(root,file))throw new ToolError('source_outside_root','Source is outside the selected project root.',2);
 const result=autofixSource(await readFile(file,'utf8'),{file,root});
 const write=!values['dry-run']&&result.changed;if(write)await replaceFile(file,result.html);
 const landed=values['dry-run']?'dry run; nothing written':write?`written to ${path.basename(file)}`:undefined;
 const report=formatAutofixReport(result,{file:path.basename(file),landed,dryRun:values['dry-run'],routine:result.routine});
 if(result.problems.length)process.exitCode=1;
 if(values.json)return {file,written:write,...autofixDetail(result,report)};
 log(report);
}
await runTool('autofix',import.meta.url,autofixCommand);
