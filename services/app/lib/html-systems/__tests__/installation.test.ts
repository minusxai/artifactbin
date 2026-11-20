/**
 * THE INSTALLATION DESIGN SYSTEM (APP__DESIGN_SYSTEM_DIR, ../installation.server): each refusal at boot, and that a
 * valid one is served like a built-in by every consumer: the platform sheet, its own sheet, its fonts, the manifest's
 * fields, page meta, server-drawn variables and offline copies. Unset, everything is the built-ins' alone.
 */
import {mkdirSync,symlinkSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {afterEach,describe,expect,it} from 'vitest';
import {overrideConfig} from '@/lib/platform/config';
import {HTML_SYSTEMS,HTML_SYSTEM_FACES} from '../html-systems';
import {HTML_SYSTEM_LABELS,HTML_SYSTEM_NAMES,defaultHtmlSystem,designSystemsManifest,htmlSystemFontPaths,htmlSystemNames,htmlSystemsCss,isHtmlSystem,setDefaultHtmlSystem,setInstallationDesignSystem} from '../index';
import {DESIGN_SYSTEM_VARIABLES,installDesignSystemFromSettings,platformFontResponse,readInstallationDesignSystem,withOfflineSystemStyle} from '../server';
import {HTML_SYSTEM_MODES} from '../../validation';
import {MARKDOWN_CSS} from '../../html-components/markdown-styles';
import {htmlAppearance} from '../../html-page/design-system';
import {nativeHtmlSystemsResponse} from '@/lib/document-serving';
import {HARBOR_FONT,harborDir,harborSpec,lightOnly} from './harbor-fixture';

afterEach(()=>{setInstallationDesignSystem(null);setDefaultHtmlSystem(null);overrideConfig({},{APP__DESIGN_SYSTEM_DIR:undefined,APP__DEFAULT_DESIGN_SYSTEM:undefined});});
const refusal=(spec:unknown,files?:Record<string,string|Buffer>)=>{try{readInstallationDesignSystem(harborDir(spec,files));}catch(error){return (error as Error).message;}return null;};
const install=(spec:unknown=harborSpec())=>{overrideConfig({},{APP__DESIGN_SYSTEM_DIR:harborDir(spec)});return installDesignSystemFromSettings()!;};
const page=(name:string)=>`<!doctype html><html><head><meta name="artifactbin:design-system" content="${name}"><title>t</title></head><body><p>x</p></body></html>`;
const fontName=(css:string)=>/url\("\/af\/fonts\/(harbor-harbor-sans-[a-f0-9]{8}\.woff2)"\)/.exec(css)?.[1];

describe('refuses the boot, naming the setting, for a directory it would not serve',()=>{
 const spec=harborSpec;
 it.each([
  ['an unknown key',{...spec(),colour:'teal'},/unknown key colour/],
  ['a malformed colour',{...spec(),tokens:[...(spec().tokens as object[]).slice(1),{name:'canvas',light:'white',dark:'#000000'}]},/tokens\.canvas\.light "white" is not a colour/],
  ['a built-in\'s slug',{...spec(),slug:'graphite'},/slug "graphite" is a built-in/],
  ['a malformed slug',{...spec(),slug:'Harbor Blue'},/slug must be lowercase/],
  ['a missing contract token',{...spec(),contract:{...(spec().contract as object),ring:'nowhere'}},/contract\.ring must name a declared token/],
  ['a family no face supplies',{...spec(),families:{...(spec().families as object),mono:'"Harbor Mono", monospace'}},/families\.mono names "Harbor Mono", which no face/],
  ['dark values on some tokens only',{...spec(),tokens:(spec().tokens as Array<Record<string,string>>).map((t,i)=>i?t:{name:t.name!,light:t.light!})},/1 of 14|13 of 14/],
  ['a dark default without dark values',{...lightOnly(),color_mode:'dark'},/needs dark values/],
  ['theme text below WCAG AA',{...spec(),tokens:(spec().tokens as Array<Record<string,string>>).map(t=>t.name==='ink-soft'?{...t,light:'#9AA5AD'}:t)},/muted-foreground \(ink-soft #9AA5AD\) on muted .* below WCAG AA/],
  ['a CSS value that escapes its declaration',{...spec(),extra_vars:{'shadow-tile':'none; } body { color: red'}},/extra_vars\.shadow-tile must be a CSS value/],
  ['a value that loads from elsewhere',{...spec(),extra_vars:{bg:'url(https://elsewhere.example/x.png)'}},/must be a CSS value/],
  ['a table cell that breaks the skill table',{...spec(),mood:'Calm | loud'},/mood must be text/],
 ])('%s',(_label,bad,message)=>{
  const problem=refusal(bad);
  expect(problem).toMatch(/^\[boot\] APP__DESIGN_SYSTEM_DIR ".*": system\.json: /);
  expect(problem).toMatch(message);
 });
 it('a font file named but absent, or present but unnamed, or not WOFF2',()=>{
  expect(refusal(harborSpec(),{})).toMatch(/fonts\[0\]\.file harbor-sans\.woff2 is missing from the directory/);
  expect(refusal(harborSpec(),{'harbor-sans.woff2':HARBOR_FONT,'spare.woff2':HARBOR_FONT})).toMatch(/spare\.woff2 is in the directory but no face in fonts names it/);
  expect(refusal(harborSpec(),{'harbor-sans.woff2':Buffer.from('not a font')})).toMatch(/harbor-sans\.woff2: not a WOFF2 font/);
 });
 it('anything but system.json and fonts, a subdirectory, a symlink, no system.json, bad JSON or no directory',()=>{
  expect(refusal(harborSpec(),{'harbor-sans.woff2':HARBOR_FONT,'notes.md':'#'})).toMatch(/notes\.md: the directory holds system\.json and the \.woff2 files/);
  const nested=harborDir();mkdirSync(path.join(nested,'more'));
  expect(()=>readInstallationDesignSystem(nested)).toThrow(/more: only files are read/);
  const linked=harborDir();symlinkSync(path.join(linked,'harbor-sans.woff2'),path.join(linked,'other.woff2'));
  expect(()=>readInstallationDesignSystem(linked)).toThrow(/other\.woff2: symlinks are not read/);
  const empty=harborDir();writeFileSync(path.join(empty,'system.json'),'{');
  expect(()=>readInstallationDesignSystem(empty)).toThrow(/system\.json is not valid JSON/);
  expect(()=>readInstallationDesignSystem(path.join(empty,'absent'))).toThrow(/cannot be read \(ENOENT\)/);
  overrideConfig({},{APP__DESIGN_SYSTEM_DIR:path.join(empty,'absent')});
  expect(()=>installDesignSystemFromSettings()).toThrow(/APP__DESIGN_SYSTEM_DIR/);
 });
});

describe('APP__DEFAULT_DESIGN_SYSTEM names the default',()=>{
 const boot=(settings:{dir?:boolean;name?:string})=>{overrideConfig({},{APP__DESIGN_SYSTEM_DIR:settings.dir?harborDir():undefined,APP__DEFAULT_DESIGN_SYSTEM:settings.name});return installDesignSystemFromSettings();};
 const url=(css:string)=>`/s/${css.length}.css`;
 it('both unset: no default',()=>{expect(boot({})).toBeNull();expect(defaultHtmlSystem()).toBeNull();expect(designSystemsManifest(url)).not.toHaveProperty('defaultDesignSystem');});
 it('only the directory: the installation system is the default',()=>{boot({dir:true});expect(defaultHtmlSystem()).toBe('harbor');expect(designSystemsManifest(url).defaultDesignSystem).toBe('harbor');});
 it('a built-in by name, with no directory: that built-in, and the built-ins alone are listed',()=>{
  boot({name:'graphite'});
  expect(defaultHtmlSystem()).toBe('graphite');
  const fields=designSystemsManifest(url);
  expect(fields.defaultDesignSystem).toBe('graphite');expect(Object.keys(fields.designSystems)).toEqual(HTML_SYSTEM_NAMES);
  expect(fields.designSystems.graphite).not.toHaveProperty('dark');
 });
 it('a built-in by name beside the directory: the built-in is the default; the installation system is still listed and served',()=>{
  boot({dir:true,name:'graphite'});
  expect(defaultHtmlSystem()).toBe('graphite');
  const fields=designSystemsManifest(url);
  expect(fields.defaultDesignSystem).toBe('graphite');expect(fields.designSystems.harbor).toMatchObject({label:'Harbor',dark:true});
  expect(isHtmlSystem('harbor')).toBe(true);expect(htmlSystemsCss(['harbor'])).toContain(':root[data-af-design-system="harbor"]');
 });
 it('the installation system by name: it',()=>{boot({dir:true,name:'harbor'});expect(defaultHtmlSystem()).toBe('harbor');});
 it('refuses the boot, naming the setting, for a name this server does not serve',()=>{
  expect(()=>boot({name:'nope'})).toThrow(/^\[boot\] APP__DEFAULT_DESIGN_SYSTEM "nope" names no design system this server serves \(one of: volta, .*graphite.*\)\. Fix it or unset the setting\.$/);
  expect(()=>boot({name:'harbor'})).toThrow(/APP__DEFAULT_DESIGN_SYSTEM "harbor" names no design system/);
  expect(defaultHtmlSystem()).toBeNull();
 });
});

describe('unset',()=>{
 it('registers nothing, and every output is the built-ins\' alone, as the generated registry writes them',async()=>{
  expect(installDesignSystemFromSettings()).toBeNull();
  expect(htmlSystemNames()).toBe(HTML_SYSTEM_NAMES);expect(defaultHtmlSystem()).toBeNull();
  const families=[...new Set(Object.values(HTML_SYSTEMS).flatMap(system=>system.families as readonly string[]))];
  expect(htmlSystemsCss()).toBe(`/* Artifactbin platform stylesheet: design systems keyed by <html data-af-design-system>. */\n${families.map(family=>HTML_SYSTEM_FACES[family]??'').filter(Boolean).join('\n')}\n${MARKDOWN_CSS}\n${Object.values(HTML_SYSTEMS).map(system=>system.rules).join('')}`);
  const url=(css:string)=>`/s/${css.length}.css`;
  expect(JSON.stringify(designSystemsManifest(url))).toBe(JSON.stringify({designSystems:Object.fromEntries(HTML_SYSTEM_NAMES.map(name=>[name,{label:HTML_SYSTEM_LABELS[name],defaultMode:HTML_SYSTEM_MODES[name],styles:url(htmlSystemsCss([name]))}]))}));
  expect(htmlAppearance(page('harbor'))).toEqual({mode:'light'});
  expect((await nativeHtmlSystemsResponse(new Request('https://app.example.test/af/styles.css?system=harbor'))).status).toBe(404);
  expect(DESIGN_SYSTEM_VARIABLES.names).toEqual(HTML_SYSTEM_NAMES);
 });
});

describe('set',()=>{
 it('serves the system like a built-in: the platform sheet, its own sheet and its content-hashed fonts',async()=>{
  const system=install();
  expect(isHtmlSystem('harbor')).toBe(true);expect(htmlSystemNames()[0]).toBe('harbor');expect(defaultHtmlSystem()).toBe('harbor');
  const all=htmlSystemsCss();
  for(const name of HTML_SYSTEM_NAMES)expect(all).toContain(`:where(:root[data-af-design-system="${name}"]) {`);
  expect(all).toContain(':where(:root[data-af-design-system="harbor"]) {\n  --ds-canvas: #FFFFFF;');
  expect(all).toContain('  --radius: 15px;\n  --radius-md: 100px;\n');
  const own=await nativeHtmlSystemsResponse(new Request('https://app.example.test/af/styles.css?system=harbor'));
  expect(own.status).toBe(200);
  const css=await own.text(),name=fontName(css)!;
  expect(css).toContain('@font-face { font-family: "Harbor Sans"; font-style: normal; font-weight: 400 700; font-display: swap; src: url("/af/fonts/');
  expect(css).not.toContain(':root[data-af-design-system="graphite"]');
  expect(css).not.toMatch(/url\("(?!\/af\/fonts\/)/);
  expect(htmlSystemFontPaths(['harbor'])).toEqual([`/af/fonts/${name}`]);
  const font=platformFontResponse(new Request(`https://app.example.test/af/fonts/${name}`),name);
  expect(font.status).toBe(200);expect(font.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
  expect(Buffer.from(await font.arrayBuffer())).toEqual(HARBOR_FONT);
  expect(system.fonts.size).toBe(1);
  expect(platformFontResponse(new Request('https://app.example.test/af/fonts/harbor-harbor-sans-00000000.woff2'),'harbor-harbor-sans-00000000.woff2').status).toBe(404);
 });

 it('names it in the manifest as the default, first, with its modes',()=>{
  install();
  const fields=designSystemsManifest(css=>`/s/${css.length}.css`);
  expect(fields.defaultDesignSystem).toBe('harbor');
  expect(Object.keys(fields.designSystems)).toEqual(['harbor',...HTML_SYSTEM_NAMES]);
  expect(fields.designSystems.harbor).toEqual({label:'Harbor',defaultMode:'light',styles:`/s/${htmlSystemsCss(['harbor']).length}.css`,dark:true});
  expect(fields.designSystems.graphite).not.toHaveProperty('dark');
 });

 it('resolves page meta and the owner\'s choice to it, and draws server charts and offline copies with it',()=>{
  install();
  expect(htmlAppearance(page('harbor'))).toEqual({designSystem:'harbor',mode:'light'});
  expect(htmlAppearance(page('graphite'),'harbor')).toEqual({designSystem:'harbor',mode:'light'});
  expect(DESIGN_SYSTEM_VARIABLES.names).toContain('harbor');
  expect(DESIGN_SYSTEM_VARIABLES.variables('harbor','light')).toMatchObject({'--primary':'var(--ds-teal)','--ds-teal':'#0B6E6E','--radius-md':'100px'});
  expect(DESIGN_SYSTEM_VARIABLES.variables('harbor','dark')).toMatchObject({'--ds-teal':'#4FC3C0'});
  const offline=withOfflineSystemStyle(page('harbor'),'https://app.example.test/a/x');
  expect(offline.html).toContain(':root[data-af-design-system="harbor"]');expect(offline.html).not.toContain('data-af-design-system="graphite"');
  expect(offline.resources).toHaveLength(1);expect(offline.resources[0]!.url).toMatch(/^https:\/\/app\.example\.test\/af\/fonts\/harbor-harbor-sans-[a-f0-9]{8}\.woff2$/);
 });

 it('keeps a light-only system light: its dark block, the manifest and server charts in dark',()=>{
  const system=install(lightOnly());
  expect(system.dark).toBe(false);
  expect(designSystemsManifest(css=>css.slice(0,1)).designSystems.harbor).toMatchObject({defaultMode:'light',dark:false});
  expect(DESIGN_SYSTEM_VARIABLES.variables('harbor','dark')).toMatchObject({'--ds-teal':'#0B6E6E','--ds-canvas':'#FFFFFF'});
  expect(htmlSystemsCss(['harbor'])).toContain(':root[data-af-design-system="harbor"][data-af-dark="true"] { color-scheme: light !important; }');
 });
});
