import {compactSkillScript} from '../preview-assets.server';
import {pathToFileURL} from 'node:url';
import {isShippedSkillTopic} from '../public-surface';
import {credentialPaths} from '@artifactbin/utils/node/credentials';
import {describe,it,expect} from 'vitest';
import {llmsText, publicGuideText} from '@/lib/agent-copy';
import {skillTree, renderSkill, skillPackageFiles, skillZip, projectSkillLinks, renderTree, skillFileWithFrontmatter} from '..';

describe('one root for installed and direct HTTP agents',()=>{
 it('gives URL readers complete HTTP operations',()=>{
  const origin='https://skills-contract.example';
  const http=llmsText(origin);
  for(const operation of ['POST /api/artifacts','PUT /api/artifacts/ID'])expect(http).toContain(operation);
  for(const field of ['expectedVersion','expectedState','Idempotency-Key','@afbin/apollo'])expect(http).toContain(field);
  expect(http).not.toContain('afbin pull');expect(http).not.toContain('afbin push');
 });
 it('names no CLI install',()=>{
  const root=llmsText('https://skills-contract.example');
  expect(root).not.toContain('@afbin/cli');
  expect(root).not.toContain('If `afbin` is missing: run');
 });
 it('serves precisely the root body with online topic links, without appending a second manual',()=>{
  const origin='https://skills-contract.example';
  const root=skillTree().get('artifactbin/SKILL.md')!;
  const expected=renderSkill(root,{base:origin}).replace(/\]\(references\/([a-z0-9-]+)\.md(#[^)\s]+)?\)/g,(_match,name:string,hash:string|undefined)=>`](${origin}/llms/${name}${hash??''})`);
  expect(llmsText(origin).trim()).toBe(expected.trim());
 });
});

import {existsSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {GET as zipRoute} from '@/app/skills/artifactbin.zip/route';
import {platformOrigin} from './platform-origin';

describe('installable shared skill folder',()=>{
 it('rewrites root/backlinks and anchors on the supplied origin',()=>{
  const file=skillTree().get('artifactbin/references/http-auth.md')!;
  expect(projectSkillLinks(file,'[root](../SKILL.md#read-first) [task](./http-auth.md#sign-in)','https://recipient.example')).toBe('[root](https://recipient.example/llms.txt#read-first) [task](https://recipient.example/llms/http-auth#sign-in)');
  expect(publicGuideText('../SKILL','https://recipient.example')).toBeNull();
 });
 it('serves one archive per origin under an ETag, public for five minutes, and 304 on revalidation',async()=>{
  const at=(origin:string,tag?:string)=>zipRoute(new Request(`${origin}/skills/artifactbin.zip`,tag?{headers:{'if-none-match':tag}}:{}));
  const first=await at('https://etag.example');
  const etag=first.headers.get('etag');
  expect(etag).toMatch(/^"[^"]+"$/);
  expect(first.headers.get('cache-control')).toBe('public, max-age=300');
  const again=await at('https://etag.example');
  expect(again.headers.get('etag')).toBe(etag);
  expect(Buffer.from(await again.arrayBuffer()).equals(Buffer.from(await first.arrayBuffer()))).toBe(true);
  const held=await at('https://etag.example',etag!);
  expect(held.status).toBe(304);
  expect(held.headers.get('etag')).toBe(etag);
  expect(await held.text()).toBe('');
  // The archive names its server: another origin is another archive.
  expect((await at('https://other.example')).headers.get('etag')).not.toBe(etag);
 });
 it('extracts a valid ZIP with the rendered frontmatter and references',async()=>{
  const origin='https://recipient.example';
  const expected=skillPackageFiles(skillTree(),origin);
  expect(Object.keys(expected)).not.toContain('scripts/credentials.mjs');
  for(const {file,text} of renderTree(skillTree(),origin,true)){
   if(file.ref&&!isShippedSkillTopic(file.file.replace(/\.md$/,'')))continue;
   expect(expected[file.path.replace(/^artifactbin\//,'')],file.path).toBe(skillFileWithFrontmatter(file,text));
  }
  for(const shim of ['scripts/publication-bundle.mjs','scripts/preview.mjs'])expect(expected[shim]).toBeUndefined();
  expect(expected['scripts/toolbox-publish-legacy.mjs']).toBeUndefined();
  expect(Object.keys(expected).some(name=>name.startsWith('resolvers/'))).toBe(false);
  expect(expected['references/datasets.md']).toContain('dataset');
  expect(expected['components/file-upload.ts']).toContain('uploadFile');
  expect(Object.keys(expected).some(name=>name.startsWith('fragments/'))).toBe(false);
  const response=await zipRoute(new Request(`${origin}/skills/artifactbin.zip`));
  expect(response.headers.get('content-type')).toBe('application/zip');
  const dir=mkdtempSync(path.join(tmpdir(),'artifactbin-skill-zip-'));
  try{
   const zip=path.join(dir,'artifactbin.zip');writeFileSync(zip,new Uint8Array(await response.arrayBuffer()));
   execFileSync('unzip',['-q','-n',zip,'-d',dir]);
   for(const [name,text] of Object.entries(expected).filter(([name])=>!['scripts/preview-html.mjs','scripts/toolbox-config.mjs','scripts/toolbox-platform.mjs'].includes(name)))expect(readFileSync(path.join(dir,'artifactbin',name),'utf8'),name).toBe(name.startsWith('scripts/')?await compactSkillScript(text):text);
   const config=await import(pathToFileURL(path.join(dir,'artifactbin/scripts/toolbox-config.mjs')).href);
   expect(config.default).toBe(origin);
   const platform=await import(/* @vite-ignore */ pathToFileURL(path.join(dir,'artifactbin/scripts/toolbox-platform.mjs')).href);
   expect(platform.parse).toBeUndefined();expect(platform.getOperationAST).toBeUndefined();
   expect(typeof platform.inspectPublicationBundle).toBe('function');
   // The installed scripts carry the one shared retry policy (lib/http/retry), bundled in.
   expect(typeof platform.retryFetch).toBe('function');
   const parser=readFileSync(path.join(dir,'artifactbin/scripts/preview-html.mjs'),'utf8');
   expect(parser).not.toMatch(/from\s*["']parse5/);
   // One copy of the HTML parser: toolbox-platform reaches it through its sibling. No GraphQL ships.
   const toolbox=readFileSync(path.join(dir,'artifactbin/scripts/toolbox-platform.mjs'),'utf8');
   expect(toolbox).toMatch(/from\s*["']\.\/preview-html\.mjs["']/);
   for(const gone of ['preview-datasets.mjs','graphql.mjs','toolbox-graphql.mjs','preview-sessions.mjs','preview-dataset-route.mjs'])expect(existsSync(path.join(dir,'artifactbin/scripts',gone)),gone).toBe(false);expect(Buffer.byteLength(toolbox)).toBeLessThan(60_000);
   // The archive carries no runtime, library or component bundles: the preview fetches them from the selected server.
   for(const retired of ['preview-runtime.mjs','preview-libraries.mjs'])expect(existsSync(path.join(dir,'artifactbin/scripts',retired)),retired).toBe(false);
   const installedParser=await import(/* @vite-ignore */ pathToFileURL(path.join(dir,'artifactbin/scripts/preview-html.mjs')).href);
   expect(expected['scripts/preview-export.mjs']).toBeUndefined();
   expect(await installedParser.packPreviewExport({html:'<!doctype html><html><head><title>Saved</title></head><body><p>Retained</p></body></html>',pathname:'/index.html',load:async()=>{throw Error('No external resources');}})).toContain('Retained');
   expect(installedParser.previewHtml('<!doctype html><html><head><script>check()</script></head><body>Source</body></html>','')).toContain('<html data-af-private-preview="true">');
   const previewModule=pathToFileURL(path.join(dir,'artifactbin/scripts/preview-server.mjs')).href;
   const {startPreview}=await import(/* @vite-ignore */ previewModule);
   const server=await platformOrigin();
   const preview=await startPreview({root:path.join(dir,'artifactbin'),port:0,platformOrigin:server.base});
   try {
    const hosted=async(pathname:string)=>{const answer=await fetch(server.base+pathname);expect(answer.status,pathname).toBe(200);return answer.text();};
    const imports=JSON.parse(await hosted('/af/import-map.json')).imports as Record<string,string>;
    expect(imports['@afbin/vega']).toBe('/af/lib/vega-6.3.1/index.js');expect(imports['@afbin/tabs']).toBe('/af/components/tabs.js');
    for(const pathname of [imports['@afbin/vega']!,imports['@afbin/vega-lite']!,imports['@afbin/tabs']!,'/af/core.js','/af/apollo.js','/af/state.js','/af/reader.js']){
     const response=await fetch(new URL(pathname,preview.url));
     expect(response.status,pathname).toBe(200);expect(await response.text(),pathname).toBe(await hosted(pathname));
    }
    expect((await fetch(new URL('/af/components/not-a-component.js',preview.url))).status).toBe(404);
    const assets=await (await fetch(new URL('/__af_preview/export-runtime',preview.url))).json();
    expect(assets.core).toContain('@afbin/apollo');expect(assets.reader).toContain('offline');
    expect(assets.apolloPath).toBe('/af/apollo.js');expect(assets.readerPath).toBe('/af/reader.js');
    expect(assets.apollo).toBe(await hosted('/af/apollo.js'));expect(assets.state).toBe(await hosted('/af/state.js'));
    // Each platform file is fetched once and then served from the preview's memory.
    const fetched=server.requests.filter(request=>request==='/af/apollo.js').length;
    await fetch(new URL('/af/apollo.js',preview.url));expect(server.requests.filter(request=>request==='/af/apollo.js').length).toBe(fetched);
   } finally {await preview.close();await server.close();}
   expect(expected['SKILL.md']).toMatch(/^---\nname: artifactbin\n/);
   expect(expected['SKILL.md']).toContain(origin);

   expect(Object.keys(expected)).not.toContain('.afbin-skill.json');
  }finally{rmSync(dir,{recursive:true,force:true});}
 });
 it('rejects arbitrary archive members and traversal',()=>{
  for(const name of ['../SKILL.md','scripts/../other.mjs','/root/file','references/../secrets.md'])expect(()=>skillZip({[name]:'bad'})).toThrow('Unsupported skill member');
 });
});


it.each(['https://docs.example','http://app.lvh.me:5001'])('projects the existing credential backing path for HTTP on %s',origin=>{
 const expected=credentialPaths(origin,'~/.artifactbin').backingPath;
 for(const text of [publicGuideText('http-auth',origin)!]){
  expect(text).toContain(expected);
  expect(text).not.toContain('__AFBIN_CREDENTIAL_PATH__');
  expect(text).not.toContain('credentials.mjs');
 }
 expect(expected).not.toBe(credentialPaths('https://other.example','~/.artifactbin').backingPath);
});

it('refuses retired monitoring instructions in the public skill',()=>{ expect(publicGuideText('monitoring','https://monitor.example')).toBeNull(); });

it('offers the complete Markdown skill archive from the HTTP root',()=>{
 const origin='https://guides.example';
 expect(llmsText(origin)).not.toContain('Optional [setup]');
 expect(llmsText(origin)).not.toContain('@afbin/cli');
 expect(llmsText(origin)).toContain(`[Download the author skill](${origin}/skills/artifactbin.zip)`);
});
it('keeps credential recovery references consistent with direct HTTP authentication',()=>{
 const origin='https://guides.example';
 for(const name of ['http-auth']){
  const text=publicGuideText(name,origin)!;
  for(const obsolete of ['same credentials and helper','common helper','helper returns the actual backing path','shared helper for every request','shared credential helper'])expect(text).not.toContain(obsolete);
  expect(text).toContain('/llms/http-auth');
 }
 expect(publicGuideText('http-auth',origin)).toContain(credentialPaths(origin,'~/.artifactbin').backingPath);
});

it('preserves deterministic stored UTF-8 members for already-installed updaters',async()=>{
 const text='Native author contract ✓\n'.repeat(1000),files={'SKILL.md':text};
 const archive=Buffer.from(skillZip(files));
 expect(archive.equals(Buffer.from(skillZip(files)))).toBe(true);
 expect(archive.readUInt16LE(8)).toBe(0);
 const start=30+archive.readUInt16LE(26),size=archive.readUInt32LE(18);
 expect(archive.subarray(start,start+size).toString()).toBe(text);
 expect(size).toBe(Buffer.byteLength(text));
 const {skillRelease}=await import('../package');
 // This is the unchanged stored-only decoder already shipped to installed clients.
 const {decodeRelease}=await import('../../../skills/artifactbin/scripts/toolbox-update-archive.mjs');
 const release=skillRelease(files,'https://example.test');
 expect(decodeRelease(Buffer.from(release.bytes),release.manifest)['SKILL.md']).toBe(text);
});

it('keeps the served release within the unchanged installed updater limit',async()=>{
 const {archiveFor}=await import('..');
 const {decodeRelease,limit}=await import('../../../skills/artifactbin/scripts/toolbox-update-archive.mjs');
 const {bytes,manifest}=await archiveFor('https://installed.example');
 expect(bytes.byteLength).toBeLessThanOrEqual(limit);
 const files=decodeRelease(Buffer.from(bytes),manifest);
 expect(files['scripts/toolbox-publication-bundle.mjs']).toBeTruthy();
 expect(files['scripts/preview-server.mjs']).toBeTruthy();
 expect(files['design-systems/almanac.css']).toBeTruthy();
 expect(files['scripts/preview-runtime.mjs']).toBeUndefined();
 expect(files['scripts/preview-libraries.mjs']).toBeUndefined();
 console.log('Stored served skill ZIP bytes:',bytes.byteLength,'installed updater limit:',limit);
});

it('compacts script whitespace without changing exports, literals, ASI or executable hashbangs',async()=>{
 const source = `#!/usr/bin/env node
// packaging-only explanation
export const preservedName = "literal  with // spaces";
export function result(value) {
 // Automatic semicolon insertion must survive packaging.
 return
 value;
}
`;
 const compact=await compactSkillScript(source);
 expect(compact.startsWith('#!/usr/bin/env node\n')).toBe(true);
 expect(compact).not.toContain('packaging-only explanation');
 expect(Buffer.byteLength(compact)).toBeLessThan(Buffer.byteLength(source));
 const installed=await import(/* @vite-ignore */ 'data:text/javascript;base64,'+Buffer.from(compact.replace(/^#![^\n]*\n/,'')).toString('base64'));
 expect(installed.preservedName).toBe('literal  with // spaces');
 expect(installed.result(42)).toBeUndefined();
});

it('preserves source-readable command descriptions verbatim for installed help readers',async()=>{
 const source='export const DESCRIPTION = `Usage: node scripts/command.mjs\n  --help`;\nexport const run = () => 42;\n';
 expect(await compactSkillScript(source)).toBe(source);
});
