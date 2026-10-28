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
it('bounds inner Debian build concurrency while preserving generated prerequisites and serial installation',()=>{
 const root=mkdtempSync(join(tmpdir(),'sqlite-build-'));
 try{
  mkdirSync(join(root,'debian'));mkdirSync(join(root,'started'));
  const source=new URL('../../deploy/company/runtime-source/browser/sqlite/prepare.py',import.meta.url).pathname;
  const apply=`import ast,pathlib,sys\nsource=pathlib.Path(sys.argv[1]).read_text()\nnode=next(n for n in ast.parse(source).body if isinstance(n,ast.FunctionDef) and n.name=='parallelize_build')\nnamespace={}\nexec(compile(ast.Module(body=[node],type_ignores=[]),sys.argv[1],'exec'),namespace)\nnamespace['parallelize_build'](pathlib.Path(sys.argv[2]),int(sys.argv[3]))\n`;
  const rules='binary-arch: build install\nbuild: build-stamp\nbuild-stamp: configure\n\t$(MAKE)\n\t$(MAKE) showdb showjournal showstat4 showwal sqldiff sqlite3_analyzer\n\ttouch build-stamp\nconfigure:\n\ttouch configured\ninstall: build\n\ttest -f build-stamp\n\t./program\n';
  writeFileSync(join(root,'debian/rules'),rules);
  writeFileSync(join(root,'a.c'),'#include "./sqlite3.h"\nint b(void); int main(void){return b()+GENERATED!=42;}\n');
  writeFileSync(join(root,'b.c'),'#include "./sqlite3.h"\nint b(void){return REQUIRED;}\n');
  writeFileSync(join(root,'compiler.mjs'),`import {writeFileSync,readdirSync} from 'node:fs';import {spawnSync} from 'node:child_process';
const args=process.argv.slice(2);if(args.includes('-c')){writeFileSync('started/'+args[args.indexOf('-c')+1],'started');const deadline=Date.now()+3000;while(readdirSync('started').length<2){if(Date.now()>deadline)throw Error('main package build remained serial');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10);}}const result=spawnSync('cc',args,{stdio:'inherit'});process.exit(result.status??1);`);
  writeFileSync(join(root,'Makefile'),`all: sqlite3.h program\nsqlite3.h:\n\tsleep 0.5; printf '#define GENERATED 35\\n' > sqlite3.h\nprogram: a.o b.o\n\tcc a.o b.o -o program\n%.o: %.c\n\t${process.execPath} compiler.mjs -nostdinc -DREQUIRED=7 -c $< -o $@\nshowdb showjournal showstat4 showwal sqldiff sqlite3_analyzer: all\n`);
  execFileSync('python3',['-c',apply,source,root,'4']);
  const patched=readFileSync(join(root,'debian/rules'),'utf8');
  expect(patched).toBe(rules.replaceAll('\t$(MAKE)','\t$(MAKE) -j4').replace('\t$(MAKE) -j4\n','\t$(MAKE) sqlite3.h\n\t$(MAKE) -j4\n'));
  writeFileSync(join(root,'debian/rules'),rules);
  let serialFailure;
  try{execFileSync('make',['-f','debian/rules','binary-arch'],{cwd:root,stdio:'pipe'});}catch(error){serialFailure=error;}
  expect(serialFailure?.stderr.toString()).toContain('main package build remained serial');
  rmSync(join(root,'sqlite3.h'),{force:true});
  writeFileSync(join(root,'debian/rules'),patched.replace('\t$(MAKE) sqlite3.h\n',''));
  let headerFailure;
  try{execFileSync('make',['-f','debian/rules','binary-arch'],{cwd:root,stdio:'pipe'});}catch(error){headerFailure=error;}
  expect(headerFailure?.stderr.toString()).toContain('sqlite3.h');
  writeFileSync(join(root,'debian/rules'),patched);
  execFileSync('make',['-f','debian/rules','binary-arch'],{cwd:root});
  writeFileSync(join(root,'b.c'),'#error preserve build failures\n');
  expect(()=>execFileSync('make',['-B','-f','debian/rules','binary-arch'],{cwd:root,stdio:'pipe'})).toThrow();
  for(const jobs of ['0','5'])expect(()=>execFileSync('python3',['-c',apply,source,root,jobs],{stdio:'pipe'})).toThrow();
  writeFileSync(join(root,'debian/rules'),rules.replace('\t$(MAKE)\n','\t$(MAKE) changed\n'));
  expect(()=>execFileSync('python3',['-c',apply,source,root,'4'],{stdio:'pipe'})).toThrow();
  expect(readFileSync(join(root,'debian/rules'),'utf8')).toContain('$(MAKE) changed');
 }finally{rmSync(root,{recursive:true,force:true});}
});
