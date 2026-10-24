import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {installedFiles} from '../fixtures/component-baseline/publication.mjs';
/** Install the actual served archive and execute its own publication contract.
 * @param {Uint8Array} archive
 * @param {string} server
 */
export async function installGateSkill(archive,server){
 const files=installedFiles(archive),root=await mkdtemp(path.join(tmpdir(),'installed-gate-skill-'));
 try{
  for(const [name,bytes] of files){const target=path.join(root,name);await mkdir(path.dirname(target),{recursive:true});await writeFile(target,bytes);}
  // The installed candidate selects its own Node helper, exactly as an author does.
  const {prepareBundle}=await import(pathToFileURL(path.join(root,'scripts/publication-bundle.mjs')).href);
  return {files,async prepare(html,entry='index.html'){
   const target=path.join(root,entry);await mkdir(path.dirname(target),{recursive:true});await writeFile(target,html);
   return prepareBundle({root,entry,server});
  },dispose:()=>rm(root,{recursive:true,force:true})};
 }catch(error){await rm(root,{recursive:true,force:true});throw error;}
}
