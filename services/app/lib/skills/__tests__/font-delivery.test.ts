import {expect,it} from 'vitest';
import {existsSync,mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {GET} from '@/app/skills/artifactbin.zip/route';
import {platformOrigin} from './platform-origin';
import {skillZip} from '../package';
import {planPublicationBundle} from '../../html-publication-bundle/plan';
import {STORY_SYSTEM_SHEETS} from '../../data/story/story-system-sheets';
import manifest from '../../data/story/story-font-manifest.json';

it('packages no font members: the archive is text only',()=>{
 for(const name of ['fonts/example.12345678.woff2','fonts/../secret.woff2','fonts/dm-sans-latin-standard-normal.woff2'])expect(()=>skillZip({[name]:'x'})).toThrow('Unsupported skill member');
});
it('installs every theme on /af/fonts/ names and previews them through the selected server, with no fonts in the archive',async()=>{
 const response=await GET(new Request('https://skill.example/skills/artifactbin.zip'));
 const root=mkdtempSync(path.join(tmpdir(),'skill-fonts-'));
 // The selected server: its /af/fonts/ and /af/styles.css routes, as the hosted app answers them.
 const origin=await platformOrigin();
 try{
  const zip=path.join(root,'skill.zip');writeFileSync(zip,new Uint8Array(await response.arrayBuffer()));
  execFileSync('unzip',['-t',zip],{stdio:'pipe'});execFileSync('unzip',['-q',zip,'-d',root]);
  const installed=path.join(root,'artifactbin');
  expect(existsSync(path.join(installed,'fonts'))).toBe(false);
  const names=Object.keys(JSON.parse(readFileSync('lib/data/story/story-system-sheets.json','utf8')));
  for(const name of names){
   const css=readFileSync(path.join(installed,'design-systems',name+'.css'),'utf8');
   expect(css,name).not.toMatch(/url\(\s*["']?https?:|fonts\.gstatic|\.\.\/fonts\//);
   expect(css,name).toContain('[data-af-dark="true"]');
   const retained=STORY_SYSTEM_SHEETS[name as keyof typeof STORY_SYSTEM_SHEETS].fontFaces.replace(/url\("\/fonts\/([a-z0-9-]+)\.[a-f0-9]{8}\.woff2"\)/g,'url("/af/fonts/$1.woff2")');
   expect((css.match(/@font-face\s*\{[^}]*\}/g)??[]).join('\n'),name+' retained descriptors').toBe(retained);
   for(const [,url] of css.matchAll(/src:\s*url\("([^"\n]+)"\)/g))expect(url).toMatch(/^\/af\/fonts\/[a-z0-9-]+\.woff2$/);
  }
  const html='<html data-af-design-system="almanac" data-af-dark="true"><head><link data-af="design-system" rel="stylesheet" href="./design-systems/almanac.css"></head><body class="t-body">Portable type</body></html>';
  writeFileSync(path.join(installed,'index.html'),html);
  const {startPreview}=await import(/* @vite-ignore */pathToFileURL(path.join(installed,'scripts/preview.mjs')).href);
  const preview=await startPreview({root:installed,port:0,revisionIntervalMs:0,platformOrigin:origin.base});
  try{
   const page=await fetch(preview.url);expect(page.status).toBe(200);
   // The served page carries the platform stylesheet for its system only (the server's /af/styles.css?system=); its /af/fonts/ files come from the selected server, served from the preview's own origin.
   const served=await page.text(),platform=/<style data-af="platform-styles">([\s\S]*?)<\/style>/.exec(served)![1]!;
   expect(platform).toContain(':root[data-af-design-system="almanac"]');expect(platform).not.toContain('data-af-design-system="redline"');
   expect(origin.requests).toContain('/af/styles.css?system=almanac');
   const hosted=/src: url\("(\/af\/fonts\/[^"]+)"\)/.exec(platform)![1]!,hostedFont=await fetch(new URL(hosted,preview.url));
   expect(hostedFont.status).toBe(200);expect(hostedFont.headers.get('content-type')).toContain('font/woff2');
   const face=Object.values(manifest.systems).flat().find(entry=>entry.url.replace(/\.[a-f0-9]{8}\.woff2$/,'.woff2')===hosted.replace('/af',''))!;
   expect(Buffer.from(await hostedFont.arrayBuffer())).toEqual(readFileSync(path.resolve('public',face.url.slice(1))));
   // The legacy hashed name still resolves, and an unknown name does not.
   expect((await fetch(new URL(face.url,preview.url))).status).toBe(200);
   expect((await fetch(new URL('/af/fonts/not-a-font.woff2',preview.url))).status).toBe(404);
  }finally{await preview.close();}
  const output=path.join(root,'publication.json');
  execFileSync(process.execPath,[path.join(installed,'scripts/publication-bundle.mjs'),installed,'index.html','https://publish.example',output],{stdio:'pipe'});
  const request=JSON.parse(readFileSync(output,'utf8'));
  const plan=planPublicationBundle(html,request.body.publicationBundle);
  // Platform font addresses are absolute: a publication uploads the stylesheet, never font bytes.
  expect(plan.dependencies.map(dep=>dep.path)).toEqual(['design-systems/almanac.css']);
 }finally{await origin.close();rmSync(root,{recursive:true,force:true});}
});
