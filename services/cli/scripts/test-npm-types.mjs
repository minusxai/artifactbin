/** Compile a real consumer outside the repository: no private workspace paths or skipLibCheck. */
import {writeFile,rm} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
const repository=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const require=createRequire(import.meta.url);
export async function checkInstalledTypes(entry){
 const root=resolve(dirname(entry),'../../../..'),fixture=join(root,'afbin-library-consumer.mts');
 await writeFile(fixture,"import {HttpClient,runRemote,loadConnection,saveConnection,normalizeServer,type RunOptions,type Connection} from '@afbin/cli';\nconst connection:Connection={server:normalizeServer('http://localhost:3030'),token:'fixture'};\nconst client=new HttpClient({connection});\nconst options:RunOptions={client,command:'echo',args:['ok'],interactive:false};\nvoid runRemote(options);void loadConnection();void saveConnection(connection);\n");
 try{
  for(const [module,resolution] of [['NodeNext','NodeNext'],['ESNext','Bundler']]){
   try{execFileSync(process.execPath,[require.resolve('typescript/bin/tsc'),'--noEmit','--strict','--skipLibCheck','false','--module',module,'--moduleResolution',resolution,'--target','ES2022','--types','node','--typeRoots',join(repository,'node_modules/@types'),fixture],{cwd:root,stdio:'pipe',timeout:30000});}
   catch(error){throw new Error(`${module} public declarations failed:\n${error.stdout?.toString()??''}${error.stderr?.toString()??''}`,{cause:error});}
  }
  console.log('PASS installed public library declarations: NodeNext and Bundler, no private aliases or skipLibCheck');
 }finally{await rm(fixture,{force:true});}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await checkInstalledTypes(resolve(process.argv[2]));
