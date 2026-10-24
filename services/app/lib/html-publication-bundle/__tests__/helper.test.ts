import {it,expect} from 'vitest';
it('runs the installed native helper with Node alone and refuses project symlinks',async()=>{
 const {mkdtemp,mkdir,writeFile,readFile,copyFile,symlink,rm}=await import('node:fs/promises');
 const {tmpdir}=await import('node:os');const {join}=await import('node:path');const {execFileSync}=await import('node:child_process');
 const dir=await mkdtemp(join(tmpdir(),'bundle-fresh-'));
 try{
  await mkdir(join(dir,'scripts'));await mkdir(join(dir,'project'));
  for(const script of ['publication-bundle.mjs','publish.mjs'])await copyFile(new URL('../../../skills/artifactbin/scripts/'+script,import.meta.url),join(dir,'scripts',script));
  const {buildPreviewParser}=await import('../../skills/preview-assets.server');
  await writeFile(join(dir,'scripts/preview-html.mjs'),await buildPreviewParser(await readFile(new URL('../../../skills/artifactbin/scripts/preview-html.mjs',import.meta.url),'utf8')));
  await writeFile(join(dir,'project','index.html'),'<img src="./logo.svg"><script type="module">import "./main.js";</script>');await writeFile(join(dir,'project','logo.svg'),'<svg/>');
  await writeFile(join(dir,'project','main.js'),'export const lazy=()=>import("./chunk.js");');await writeFile(join(dir,'project','chunk.js'),'export const value=42;');
  execFileSync(process.execPath,[join(dir,'scripts/publication-bundle.mjs'),join(dir,'project'),'index.html','https://example.test',join(dir,'request.json')]);
  const request=JSON.parse(await readFile(join(dir,'request.json'),'utf8'));expect(request.body.publicationBundle.files[0].path).toBe('logo.svg');expect(request).not.toHaveProperty('token');expect(request.body.publicationBundle.files.map((file:{path:string})=>file.path)).toEqual(['logo.svg','main.js','chunk.js']);
  await rm(join(dir,'project/logo.svg'));await symlink(join(dir,'request.json'),join(dir,'project/logo.svg'));
  expect(()=>execFileSync(process.execPath,[join(dir,'scripts/publication-bundle.mjs'),join(dir,'project'),'index.html','https://example.test',join(dir,'other.json')],{stdio:'pipe'})).toThrow();
 }finally{await rm(dir,{recursive:true,force:true});}
});

it('snapshots inline, static and lazy module graphs with shared chunks once',async()=>{
 const {mkdtemp,mkdir,writeFile,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 const {prepareBundle}=await import('../../../skills/artifactbin/scripts/publication-bundle.mjs');
 const root=await mkdtemp(join(tmpdir(),'bundle-modules-'));
 try{
  await mkdir(join(root,'components/chunks'),{recursive:true});
  await writeFile(join(root,'index.html'),'<script type="module">import {lazy} from "./components/main.js"; export const answer=await lazy();</script>');
  await writeFile(join(root,'components/main.js'),'import "./shared.js"; export const lazy=()=>import("./chunks/lazy.js?version=1#export");');
  await writeFile(join(root,'components/shared.js'),'export const value=42;');
  await writeFile(join(root,'components/chunks/lazy.js'),'export {value} from "../shared.js";');
  const bundle=await prepareBundle({root,entry:'index.html',server:'https://example.test'});
  expect(bundle.body.publicationBundle.files.map((file:{path:string})=>file.path).sort()).toEqual(['components/chunks/lazy.js','components/main.js','components/shared.js']);
  const {planPublicationBundle}=await import('../plan');
  const plan=planPublicationBundle(bundle.body.html,bundle.body.publicationBundle);
  const addresses=new Map(plan.dependencies.map(dep=>[dep.path,'/a/PAGE12/assets?dependency='+encodeURIComponent(dep.path)+'&revision=1']));
  expect(plan.rewrite(Buffer.from(bundle.body.publicationBundle.files.find((file:{path:string})=>file.path==='components/main.js').base64,'base64').toString(),'components/main.js',addresses)).toContain('import("/a/PAGE12/assets?dependency=components%2Fchunks%2Flazy.js&revision=1&version=1#export")');
  const {packOfflineDependencies}=await import('../../offline-dependencies');
  const offline=await packOfflineDependencies({html:plan.rewrite(bundle.body.html,'index.html',addresses),baseUrl:'https://example.test/index.html',resources:plan.dependencies.map(dep=>({url:addresses.get(dep.path)!,contentType:dep.contentType,bytes:Buffer.from(plan.rewrite(Buffer.from(dep.bytes).toString(),dep.path,addresses))}))});
  expect(offline.embeddedUrls).toHaveLength(3);
  const offlineSource=offline.html.slice(offline.html.indexOf('>')+1,offline.html.lastIndexOf('</script>'));
  const executed=await import('data:text/javascript;base64,'+Buffer.from(offlineSource).toString('base64'));
  expect(executed.answer.value).toBe(42);
  await writeFile(join(root,'components/shared.js'),'import "./main.js";');
  const cyclic=await prepareBundle({root,entry:'index.html',server:'https://example.test'});
  expect(cyclic.body.publicationBundle.files).toHaveLength(3);
  expect(()=>planPublicationBundle(cyclic.body.html,cyclic.body.publicationBundle)).toThrow(/cycle/);
  await rm(join(root,'components/chunks/lazy.js'));
  await expect(prepareBundle({root,entry:'index.html',server:'https://example.test'})).rejects.toThrow();
  await writeFile(join(root,'components/main.js'),'const name="./shared.js";import(name);');
  await expect(prepareBundle({root,entry:'index.html',server:'https://example.test'})).rejects.toThrow(/Computed module imports/);
  await writeFile(join(root,'components/main.js'),'import "../../outside.js";');
  await expect(prepareBundle({root,entry:'index.html',server:'https://example.test'})).rejects.toThrow(/escapes/);
 }finally{await rm(root,{recursive:true,force:true});}
});

it('preserves URL query identity in inline modules and styles while escaping HTML attributes',async()=>{
 const {planPublicationBundle,pinPublicationAssetUrls}=await import('../plan');
 const html='<script type="module">import "./x.js";</script><style>.a{background:url(./x.png)}</style><img src="./x.png">';
 const files=[{path:'x.js',contentType:'text/javascript',base64:Buffer.from('export const x=1;').toString('base64')},{path:'x.png',contentType:'image/png',base64:Buffer.from('png').toString('base64')}];
 const plan=planPublicationBundle(html,{entryPath:'index.html',files});const address='/a/PAGE12/assets?dependency=ASSET1&revision=2';
 const rewritten=plan.rewrite(html,'index.html',new Map([['x.js',address],['x.png',address]]));
 expect(rewritten).toContain('import "'+address+'"');expect(rewritten).toContain('url('+address+')');expect(rewritten).toContain('src="'+address.replace('&','&amp;')+'"');
 const pinned=pinPublicationAssetUrls(rewritten,'PAGE12',3);
 expect(pinned).toContain('import "'+address+'&version=3"');expect(pinned).toContain('url('+address+'&version=3)');expect(pinned).toContain('src="'+address.replace('&','&amp;')+'&amp;version=3"');
});

it('snapshots every quoted font URL and escaped CSS import without admitting comment or content strings',async()=>{
 const {mkdtemp,mkdir,writeFile,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const {join}=await import('node:path');const {prepareBundle}=await import('../../../skills/artifactbin/scripts/publication-bundle.mjs');const {planPublicationBundle}=await import('../plan');
 const root=await mkdtemp(join(tmpdir(),'bundle-fonts-'));try{
  await mkdir(join(root,'css'));await mkdir(join(root,'fonts'));await writeFile(join(root,'index.html'),'<link rel="stylesheet" href="./css/main.css">');
  await writeFile(join(root,'css/main.css'),'@font-face{src:url("../fonts/first.woff2")}@font-face{src:url(\'../fonts/second.woff2\')}@import "./nested\\20 theme.css";/*url("../fonts/ignored.woff2")*/.a{content:"url(../fonts/also-ignored.woff2)"}');
  await writeFile(join(root,'css/nested theme.css'),'@font-face{src:url("../fonts/third\\20 face.woff2")}');
  for(const name of ['first.woff2','second.woff2','third face.woff2'])await writeFile(join(root,'fonts',name),name);
  const prepared=await prepareBundle({root,entry:'index.html',server:'https://example.test'});
  expect(prepared.body.publicationBundle.files.map(file=>file.path).sort()).toEqual(['css/main.css','css/nested theme.css','fonts/first.woff2','fonts/second.woff2','fonts/third face.woff2']);
  expect(planPublicationBundle(prepared.body.html,prepared.body.publicationBundle).dependencies).toHaveLength(5);
 }finally{await rm(root,{recursive:true,force:true});}
});

it('snapshots an admitted in-memory entry override before discovery without changing disk source',async()=>{
 const {mkdtemp,writeFile,readFile,symlink,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const {join}=await import('node:path');const {prepareBundle}=await import('../../../skills/artifactbin/scripts/publication-bundle.mjs');
 const root=await mkdtemp(join(tmpdir(),'bundle-entry-'));try{
  const original='<script type="module" src="./old.js"></script>',html='<script type="module" src="./new.js"></script>';
  await writeFile(join(root,'index.html'),original);for(const name of ['old.js','new.js'])await writeFile(join(root,name),'export const value=42;');
  const prepared=await prepareBundle({root,entry:'index.html',entryHtml:html,server:'https://example.test'});
  expect(prepared.body.html).toBe(html);expect(prepared.body.publicationBundle.files.map(file=>file.path)).toEqual(['new.js']);expect(await readFile(join(root,'index.html'),'utf8')).toBe(original);
  for(const entry of ['missing.html','../escape.html'])await expect(prepareBundle({root,entry,entryHtml:html,server:'https://example.test'})).rejects.toThrow();
  await symlink(join(root,'index.html'),join(root,'link.html'));await expect(prepareBundle({root,entry:'link.html',entryHtml:html,server:'https://example.test'})).rejects.toThrow(/Symlink/);
  await expect(prepareBundle({root,entry:'index.html',entryHtml:'x'.repeat(4_000_001),server:'https://example.test'})).rejects.toThrow(/limit/);expect(await readFile(join(root,'index.html'),'utf8')).toBe(original);
 }finally{await rm(root,{recursive:true,force:true});}
});
