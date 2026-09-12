/** Package only this target's engine. Transform copies, never the installed dependencies. */
import {createRequire} from 'node:module';
import {dirname,join,resolve} from 'node:path';
import {readdir,readFile,writeFile,mkdtemp,rm,copyFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const require=createRequire(import.meta.url);
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
export function standaloneSqlSource(source){
 const needle="duckdbModule ??= import('@duckdb/node-api')";
 if(!source.includes(needle))throw new Error('SQL lazy import changed; review standalone composition.');
 return source.replace(needle,"duckdbModule ??= require('afbin:sql-native').loadDuckDB()");
}
export async function duckdbNative(){
 const musl=process.platform==='linux'&&!process.report.getReport().header.glibcVersionRuntime;
 if(musl)throw new Error('Standalone releases currently require glibc on Linux.');
 const target=`@duckdb/node-bindings-${process.platform}-${process.arch}`;
 const files=[],chunks=[],staging=await mkdtemp(join(tmpdir(),'afbin-native-build-'));
 async function collect(root,relative,destination){
  for(const entry of (await readdir(join(root,relative),{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name,'en'))){
   const path=join(relative,entry.name);
   if(entry.isDirectory())await collect(root,path,destination);
   else if(entry.isFile()&&!/\.(?:map|ts|pdb)$/.test(path)){
    let source=join(root,path);
    if(/\.(?:dylib|so|node)$/.test(path)){
     const copy=join(staging,`${files.length}-${entry.name}`);await copyFile(source,copy);source=copy;
     if(process.platform==='darwin'){
      const arch=process.arch==='x64'?'x86_64':'arm64';
      const architectures=execFileSync('lipo',['-archs',copy],{encoding:'utf8'}).trim().split(/\s+/);
      if(architectures.length>1)execFileSync('lipo',[copy,'-thin',arch,'-output',copy+'.thin']);
      if(architectures.length>1){await copyFile(copy+'.thin',copy);await rm(copy+'.thin');}
      execFileSync('strip',['-x',copy]);
      execFileSync('codesign',['--force','--sign','-',copy]);
     }else execFileSync('strip',['--strip-unneeded',copy]);
    }
    const bytes=await readFile(source);chunks.push(bytes);files.push({path:join('node_modules',destination,path).split('\\').join('/'),size:bytes.length,sha256:sha256(bytes)});
   }
  }
 }
 try{for(const name of ['@duckdb/node-api','@duckdb/node-bindings',target,'detect-libc'])await collect(dirname(require.resolve(`${name}/package.json`)),'',name);}
 finally{await rm(staging,{recursive:true,force:true});}
 const version=JSON.parse(await readFile('package.json','utf8')).version;
 const file=`afbin-sql-${process.platform}-${process.arch}.gz`,bytes=gzipSync(Buffer.concat(chunks),{level:9});
 await writeFile(join('dist',file),bytes);
 const manifest={url:`https://github.com/minusxai/artifactbin/releases/download/afbin-v${version}/${file}`,sha256:sha256(bytes),files};
 const asset=resolve(`dist/afbin-sql-${process.platform}-${process.arch}.manifest.json`);await writeFile(asset,JSON.stringify(manifest)+'\n');
 return {asset,file,manifest,plugin:{name:'lazy-duckdb',setup(b){
  // Preserve the SQL service contract; redirect only its already-sanctioned lazy native import.
  b.onLoad({filter:/sql\/src\/engine\.ts$/},async({path})=>{
   const source=await readFile(path,'utf8');
   return {contents:standaloneSqlSource(source),loader:'ts',resolveDir:dirname(path)};
  });
  b.onResolve({filter:/^afbin:sql-native$/},()=>({path:resolve('src/standalone-sql.ts')}));
 }}};
}
