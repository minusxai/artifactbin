/** Bundle the installed target's native engine, preserving its package-relative shared library. */
import {createRequire} from 'node:module';
import {dirname,join,resolve} from 'node:path';
import {readdir,readFile,writeFile} from 'node:fs/promises';
import {gzipSync} from 'node:zlib';
const require=createRequire(import.meta.url);
export async function duckdbNative(){
 const musl=process.platform==='linux'&&!process.report.getReport().header.glibcVersionRuntime;
 const target=`@duckdb/node-bindings-${process.platform}-${process.arch}${musl?'-musl':''}`;
 const files={};
 async function collect(root,relative,destination){
  for(const entry of await readdir(join(root,relative),{withFileTypes:true})){
   const path=join(relative,entry.name);
   if(entry.isDirectory())await collect(root,path,destination);
   else if(entry.isFile()&&!/\.(?:map|ts|pdb)$/.test(path))files[join('node_modules',destination,path)]=(await readFile(join(root,path))).toString('base64');
  }
 }
 for(const name of ['@duckdb/node-api','@duckdb/node-bindings',target,'detect-libc'])await collect(dirname(require.resolve(`${name}/package.json`)),'',name);
 const asset=resolve('dist/duckdb.json.gz');await writeFile(asset,gzipSync(JSON.stringify(files)));
 const loader=`
const {getAsset}=require('node:sea');
const {mkdtempSync,mkdirSync,writeFileSync,rmSync}=require('node:fs');
const {tmpdir}=require('node:os');
const {join,dirname}=require('node:path');
const {gunzipSync}=require('node:zlib');
const {createRequire}=require('node:module');
const root=mkdtempSync(join(tmpdir(),'afbin-sql-'));
process.on('exit',()=>{try{rmSync(root,{recursive:true,force:true});}catch{}});
for(const [file,data] of Object.entries(JSON.parse(gunzipSync(Buffer.from(getAsset('duckdb'))).toString()))){
 const path=join(root,file);mkdirSync(dirname(path),{recursive:true,mode:0o700});writeFileSync(path,Buffer.from(data,'base64'),{mode:0o600});
}
module.exports=createRequire(join(root,'loader.cjs'))('@duckdb/node-api');
`;
 return {asset,plugin:{name:'embedded-duckdb',setup(b){
  b.onResolve({filter:/^@duckdb\/node-api$/},()=>({path:'duckdb',namespace:'afbin-native'}));
  b.onLoad({filter:/.*/,namespace:'afbin-native'},()=>({contents:loader,loader:'js'}));
 }}};
}
