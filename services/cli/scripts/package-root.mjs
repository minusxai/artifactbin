import {createRequire} from 'node:module';
import {readFile,realpath} from 'node:fs/promises';
import {join} from 'node:path';
/** Build-time package discovery uses Node's search order, independent of runtime exports. */
export async function packageRoot(name,from){
 const require=createRequire(join(from,'package.json'));
 for(const base of require.resolve.paths(name)??[]){
  const directory=join(base,name);
  try{
   const pkg=JSON.parse(await readFile(join(directory,'package.json'),'utf8'));
   if(pkg.name!==name)throw new Error('Unexpected runtime package identity: '+name);
   return {directory:await realpath(directory),pkg};
  }catch(error){if(error.code!=='ENOENT')throw error;}
 }
 throw Object.assign(new Error('Cannot locate runtime package '+name),{code:'MODULE_NOT_FOUND'});
}
