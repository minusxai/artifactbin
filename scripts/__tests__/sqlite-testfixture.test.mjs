import {it,expect} from 'vitest';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
const recipe=new URL('../../deploy/company/runtime-source/browser/sqlite/testfixture.mk',import.meta.url).pathname;
it('compiles every unique test source with original flags and links the static library last',()=>{
 const root=mkdtempSync(join(tmpdir(),'sqlite-fixture-'));
 try{
  for(const dir of ['a','b','src','.libs'])mkdirSync(join(root,dir));
  writeFileSync(join(root,'a/same.c'),'int a(void){return FLAG;}\n');
  writeFileSync(join(root,'b/same.c'),'int b(void){return TEMP;}\n');
  writeFileSync(join(root,'src/tclsqlite.c'),'int a(void);int b(void);int library(void);int main(void){return a()+b()+library()!=42;}\n');
  writeFileSync(join(root,'library.c'),'int library(void){return 30;}\n');
  execFileSync('cc',['-c','library.c','-o','library.o'],{cwd:root});
  execFileSync('ar',['rcs','.libs/libsqlite3.a','library.o'],{cwd:root});
  mkdirSync(join(root,'started'));
  writeFileSync(join(root,'compiler.mjs'),`import {writeFileSync,readdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
const args=process.argv.slice(2), index=args.indexOf('-c');
if(index>=0){
 writeFileSync('started/'+Buffer.from(args[index+1]).toString('base64url'),'started');
 const deadline=Date.now()+3000;
 while(readdirSync('started').length<2){
  if(Date.now()>deadline)throw Error('independent translation units did not compile concurrently');
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10);
 }
}
const result=spawnSync('cc',args,{stdio:'inherit'});process.exit(result.status??1);
`);
  writeFileSync(join(root,'Makefile'),`TOP = ${root}\nTESTSRC = a/same.c b/same.c\nTESTSRC2 = a/same.c\nTCC = ${process.execPath} compiler.mjs -DFLAG=5\nLTCOMPILE_EXTRAS = -Werror\nLTLINK = $(TCC) $(LTCOMPILE_EXTRAS)\nTEMP_STORE = -DTEMP=7\nTESTFIXTURE_FLAGS = -DREQUIRED_TEST_FLAG=1\n.PHONY: has_tclsh85\nhas_tclsh85:\n`);
  const output=execFileSync('make',['-f','Makefile','-f',recipe,'-j2','parallel-testfixture'],{cwd:root,encoding:'utf8'});
  expect(output.match(/ -c /g)).toHaveLength(3);
  expect(output).toContain('-Werror -DSQLITE_NO_SYNC=1 -DTEMP=7 -DREQUIRED_TEST_FLAG=1');
  expect(output.trim().split('\n').at(-1)).toMatch(/\.o .*\.libs\/libsqlite3\.a/);
  execFileSync(join(root,'testfixture'));
  writeFileSync(join(root,'a/same.c'),'#error compilation must fail\n');
  expect(()=>execFileSync('make',['-B','-f','Makefile','-f',recipe,'-j2','parallel-testfixture'],{cwd:root,stdio:'pipe'})).toThrow();
  expect(readFileSync(join(root,'a/same.c'),'utf8')).toContain('#error');
 }finally{rmSync(root,{recursive:true,force:true});}
});
