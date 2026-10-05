/** Deterministic runtime fixtures use installed packages, never an implicit npm cache or registry. */
import {cp,mkdir,readFile,access} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {dirname,join,resolve} from 'node:path';
export async function installedPackage(name,from){
 const require=createRequire(join(from,'package.json'));
 try{return dirname(require.resolve(name+'/package.json'));}
 catch{
  // Native packages can export only bindings/lib paths, hiding both root and package.json.
  for(const directory of require.resolve.paths(name)??[]){
   const candidate=join(directory,name);
   try{await readFile(join(candidate,'package.json'),'utf8');return candidate;}catch{}
  }
  throw new Error('Cannot locate installed package '+name);
 }
}

export async function copyInstalledPackage(name,from,target){
 const source=await installedPackage(name,from),directory=join(target,'node_modules',name);
 try{await access(join(directory,'package.json'));return resolve(directory);}catch{}
 await mkdir(dirname(directory),{recursive:true});
 await cp(source,directory,{recursive:true,filter:path=>!path.startsWith(join(source,'node_modules'))});
 const pkg=JSON.parse(await readFile(join(directory,'package.json'),'utf8'));
 for(const dependency of Object.keys(pkg.dependencies??{}))await copyInstalledPackage(dependency,source,directory);
 for(const dependency of Object.keys(pkg.optionalDependencies??{})){
  let available;try{available=await installedPackage(dependency,source);}catch{continue;}
  if(available)await copyInstalledPackage(dependency,source,directory);
 }
 return resolve(directory);
}
