import {it,expect} from 'vitest';
it('runs the installed native helper with Node alone and refuses project symlinks',async()=>{
 const {mkdtemp,mkdir,writeFile,readFile,copyFile,symlink,rm}=await import('node:fs/promises');
 const {tmpdir}=await import('node:os');const {join}=await import('node:path');const {execFileSync}=await import('node:child_process');
 const dir=await mkdtemp(join(tmpdir(),'bundle-fresh-'));
 try{
  await mkdir(join(dir,'scripts'));await mkdir(join(dir,'project'));
  for(const script of ['publication-bundle.mjs','publish.mjs'])await copyFile(new URL('../../../skills/artifactbin/scripts/'+script,import.meta.url),join(dir,'scripts',script));
  await writeFile(join(dir,'project','index.html'),'<img src="./logo.svg">');await writeFile(join(dir,'project','logo.svg'),'<svg/>');
  execFileSync(process.execPath,[join(dir,'scripts/publication-bundle.mjs'),join(dir,'project'),'index.html','https://example.test',join(dir,'request.json')]);
  const request=JSON.parse(await readFile(join(dir,'request.json'),'utf8'));expect(request.body.publicationBundle.files[0].path).toBe('logo.svg');expect(request).not.toHaveProperty('token');
  await rm(join(dir,'project/logo.svg'));await symlink(join(dir,'request.json'),join(dir,'project/logo.svg'));
  expect(()=>execFileSync(process.execPath,[join(dir,'scripts/publication-bundle.mjs'),join(dir,'project'),'index.html','https://example.test',join(dir,'other.json')],{stdio:'pipe'})).toThrow();
 }finally{await rm(dir,{recursive:true,force:true});}
});
