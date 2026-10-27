import {existsSync} from 'node:fs';
import path from 'node:path';
import {expect,it} from 'vitest';
import {HTML_SYSTEM_NAMES,htmlSystemFontPaths,htmlSystemsCss,isHtmlSystem} from '../index';
import manifest from '../../data/story/story-font-manifest.json';

it('carries every system keyed by its root attribute, with dark values, type roles and highlight tokens',()=>{
 const css=htmlSystemsCss();
 expect(HTML_SYSTEM_NAMES).toHaveLength(13);
 for(const name of HTML_SYSTEM_NAMES){
  const selector=`:root[data-af-design-system="${name}"]`;
  for(const rule of [`${selector} {`,`${selector}[data-af-dark="true"] {`,`${selector} .t-`,`${selector} .tok-keyword`])expect(css,`${name}: ${rule}`).toContain(rule);
 }
 expect(isHtmlSystem('redline')).toBe(true);expect(isHtmlSystem('constructor')).toBe(false);
});

it('declares each hosted font face once, on immutable /fonts/ files the app serves',()=>{
 const css=htmlSystemsCss(),sources=[...css.matchAll(/src: url\("([^"]+)"\)/g)].map(match=>match[1]!);
 expect(sources.length).toBe(new Set(sources).size);
 const packaged=new Set(Object.values(manifest.systems).flat().map(face=>face.url));
 for(const url of sources){expect(url).toMatch(/^\/fonts\/[a-z0-9-]+\.[a-f0-9]{8}\.woff2$/);expect(packaged.has(url),url).toBe(true);}
 expect(existsSync(path.resolve('public',sources[0]!.slice(1)))||existsSync(path.resolve('services/app/public',sources[0]!.slice(1)))).toBe(true);
});

it('gives exports only the active system and its fonts',()=>{
 const css=htmlSystemsCss(['redline']);
 expect(css).toContain(':root[data-af-design-system="redline"]');expect(css).not.toContain(':root[data-af-design-system="riso"]');
 expect(htmlSystemFontPaths(['redline']).length).toBeLessThan(htmlSystemFontPaths(HTML_SYSTEM_NAMES).length);
 expect(htmlSystemsCss(['unknown'])).not.toContain('@font-face');
});
