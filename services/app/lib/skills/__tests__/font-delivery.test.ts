import {expect,it} from 'vitest';
import {build} from 'esbuild';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {GET} from '@/app/skills/artifactbin.zip/route';
import {skillFontFiles} from '../font-assets.server';
import {skillZip} from '../package';
import {planPublicationBundle} from '../../html-publication-bundle/plan';
import {packOfflineDependencies} from '../../offline-dependencies';
import {STORY_SYSTEM_SHEETS} from '../../data/story/story-system-sheets';
import manifest from '../../data/story/story-font-manifest.json';

it('stores binary fonts with accurate ZIP size and CRC, refusing paths outside font members',()=>{
 const bytes=new Uint8Array([0x77,0x4f,0x46,0x32,0,255,128,1]);
 const zip=Buffer.from(skillZip({'fonts/example.12345678.woff2':bytes}));
 expect(zip.readUInt32LE(18)).toBe(bytes.length);expect(zip.readUInt32LE(22)).toBe(bytes.length);
 let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}crc=(crc^0xffffffff)>>>0;
 expect(zip.readUInt32LE(14)).toBe(crc);expect(zip.subarray(30+zip.readUInt16LE(26),30+zip.readUInt16LE(26)+bytes.length)).toEqual(Buffer.from(bytes));
 for(const name of ['fonts/../secret.woff2','fonts/nested/private.woff2','fonts/example.woff2','scripts/private.mjs'])expect(()=>skillZip({[name]:bytes})).toThrow('Unsupported skill member');
});
it('installs all themes with exact local font bytes and publishes Almanac through the normal bounded graph',async()=>{
 const response=await GET(new Request('https://skill.example/skills/artifactbin.zip'));
 const root=mkdtempSync(path.join(tmpdir(),'skill-fonts-'));
 try{
  const zip=path.join(root,'skill.zip');writeFileSync(zip,new Uint8Array(await response.arrayBuffer()));
  execFileSync('unzip',['-t',zip],{stdio:'pipe'});execFileSync('unzip',['-q',zip,'-d',root]);
  const installed=path.join(root,'artifactbin');
  const names=Object.keys(JSON.parse(readFileSync('lib/data/story/story-system-sheets.json','utf8')));
  let themeFonts=0;
  for(const name of names){
   const css=readFileSync(path.join(installed,'design-systems',name+'.css'),'utf8');
   expect(css,name).not.toMatch(/url\(\s*["']?https?:|fonts\.gstatic/);
   expect(css,name).toContain('[data-af-dark="true"]');
   const retained=STORY_SYSTEM_SHEETS[name as keyof typeof STORY_SYSTEM_SHEETS].fontFaces.replaceAll('url("/fonts/','url("../fonts/');
   expect((css.match(/@font-face\s*\{[^}]*\}/g)??[]).join('\n'),name+' retained descriptors').toBe(retained);
   const urls=[...css.matchAll(/src:\s*url\("([^"\n]+)"\)/g)].map(match=>match[1]!);expect(urls.length,name).toBeGreaterThan(0);expect(new Set(urls).size+1,name+' bundle file budget').toBeLessThan(99);let bytes=Buffer.byteLength(css);
   for(const url of urls){expect(url).toMatch(/^\.\.\/fonts\/[a-z0-9-]+\.[a-f0-9]{8}\.woff2$/);const packaged=readFileSync(path.resolve(installed,'design-systems',url));expect(packaged).toEqual(readFileSync(path.resolve('public',url.slice(3))));expect(packaged.subarray(0,4).toString()).toBe('wOF2');expect(packaged.length).toBeLessThan(4_000_000);bytes+=packaged.length;themeFonts++;}
   expect(bytes,name+' bundle byte budget').toBeLessThan(16_000_000);
  }
  expect(themeFonts).toBeGreaterThan(100);
  const html='<html data-af-design-system="almanac" data-af-dark="true"><head><link data-af="design-system" rel="stylesheet" href="./design-systems/almanac.css"></head><body class="t-body">Portable type</body></html>';
  writeFileSync(path.join(installed,'index.html'),html);
  const {startPreview}=await import(/* @vite-ignore */pathToFileURL(path.join(installed,'scripts/preview.mjs')).href);
  const preview=await startPreview({root:installed,port:0,revisionIntervalMs:0});
  try{
   const page=await fetch(preview.url);expect(page.status).toBe(200);
   const cssResponse=await fetch(new URL('/design-systems/almanac.css',preview.url));expect(cssResponse.status).toBe(200);
   const css=await cssResponse.text();const reference=/src:\s*url\("([^"\n]+)"\)/.exec(css)![1]!;
   const font=await fetch(new URL(reference,cssResponse.url));expect(font.status).toBe(200);expect(font.headers.get('content-type')).toContain('font/woff2');
   expect(Buffer.from(await font.arrayBuffer())).toEqual(readFileSync(path.resolve(installed,'design-systems',reference)));
  }finally{await preview.close();}
  const output=path.join(root,'publication.json');
  execFileSync(process.execPath,[path.join(installed,'scripts/publication-bundle.mjs'),installed,'index.html','https://publish.example',output],{stdio:'pipe'});
  const request=JSON.parse(readFileSync(output,'utf8'));expect(readFileSync(path.join(installed,'index.html'),'utf8')).toBe(html);
  const plan=planPublicationBundle(html,request.body.publicationBundle);
  const faces=['Instrument Serif','DM Sans','DM Mono'].flatMap(family=>manifest.systems[family as keyof typeof manifest.systems]);
  const expected=new Set(faces.map(face=>'fonts/'+face.url.split('/').at(-1)));
  expect(new Set(plan.dependencies.filter(dep=>dep.contentType==='font/woff2').map(dep=>dep.path))).toEqual(expected);
  expect(plan.dependencies.length).toBeLessThan(99);expect(plan.dependencies.reduce((sum,dep)=>sum+dep.bytes.length,0)).toBeLessThan(16_000_000);
  const baseUrl='https://publish.example/index.html';
  const portable=await packOfflineDependencies({html,baseUrl,resources:plan.dependencies.map(dep=>({url:new URL(dep.path,baseUrl).href,contentType:dep.contentType,bytes:dep.bytes}))});
  const cssData=/data:text\/css;base64,([A-Za-z0-9+/=]+)/.exec(portable.html);expect(Boolean(cssData)).toBe(true);
  const packedCss=Buffer.from(cssData![1]!,'base64').toString('utf8');
  const embedded=[...packedCss.matchAll(/data:font\/woff2;base64,([A-Za-z0-9+/=]+)/g)].map(match=>Buffer.from(match[1]!,'base64'));
  const sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
  expect(new Set(embedded.map(sha))).toEqual(new Set(plan.dependencies.filter(dep=>dep.contentType==='font/woff2').map(dep=>sha(dep.bytes))));
  expect(packedCss.includes('../fonts/')).toBe(false);expect(packedCss.includes('gstatic')).toBe(false);
 }finally{rmSync(root,{recursive:true,force:true});}
});

it('refuses unregistered, absolute and escaping font paths before reading any bytes',()=>{
 for(const url of ['https://fonts.example/font.woff2','../fonts/private.12345678.woff2','../fonts/../../private.12345678.woff2','fonts/dm-sans-latin-standard-normal.ca72d2bc.woff2']){
  for(const src of [`url("${url}")`,`url(${url})`])expect(()=>skillFontFiles({'design-systems/test.css':`@font-face{src:${src}}`})).toThrow('Unsupported skill font reference');
 }
});

it('reads only package-cwd public fonts after relocating the bundled server module',async()=>{
 const root=mkdtempSync(path.join(tmpdir(),'bundled-skill-fonts-'));
 try{
  const outfile=path.join(root,'server.mjs');
  await build({entryPoints:[path.resolve('lib/skills/font-assets.server.ts')],outfile,bundle:true,platform:'node',format:'esm',target:'node22'});
  const bundled=await import(/* @vite-ignore */pathToFileURL(outfile).href);
  const face=manifest.systems['DM Sans'][0]!,member=face.url.slice(1);
  const css={'design-systems/theme.css':`@font-face {src:url("..${face.url}")}`};
  const bytes=await bundled.skillFontFiles(css);
  expect(Buffer.from(bytes[member])).toEqual(readFileSync(path.resolve('public',member)));
 }finally{rmSync(root,{recursive:true,force:true});}
});
