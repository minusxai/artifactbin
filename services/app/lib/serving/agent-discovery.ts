/**
 * The agent one-pager: `skills/artifactbin/llms.txt`, served with `[[ base ]]` filled in
 * (agent-references.server). Its first line is the blurb (`agentBlurb`) still used elsewhere.
 * Read once per process; the file ships in the image beside `skills/`. The pointers every page
 * carries to it are lib/compiled-page/agent-discovery.
 */
import {readFileSync} from 'node:fs';
import path from 'node:path';
let source:string|null=null;
export function llmsSource():string{
 return source??=readFileSync(path.resolve(process.cwd(),'skills/artifactbin/llms.txt'),'utf8');
}
/** The one sentence that says what artifactbin is: line 1 of llms.txt. */
export function agentBlurb():string{return llmsSource().split('\n')[0]!.trim();}
