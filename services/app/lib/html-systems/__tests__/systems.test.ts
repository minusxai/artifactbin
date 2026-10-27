import {existsSync} from 'node:fs';
import path from 'node:path';
import {expect,it} from 'vitest';
import {HTML_SYSTEM_NAMES,PLATFORM_FONTS_PATH,htmlSystemFontPaths,htmlSystemsCss,isHtmlSystem,platformFontName} from '../index';
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

it('declares each platform font face once, on /af/fonts/ names that map to exactly one packaged file',()=>{
 const css=htmlSystemsCss(),sources=[...css.matchAll(/src: url\("([^"]+)"\)/g)].map(match=>match[1]!);
 expect(sources.length).toBe(new Set(sources).size);
 const packaged=new Map(Object.values(manifest.systems).flat().map(face=>[PLATFORM_FONTS_PATH+platformFontName(face.url),face.url]));
 for(const url of sources){expect(url).toMatch(/^\/af\/fonts\/[a-z0-9-]+\.woff2$/);expect(packaged.has(url),url).toBe(true);}
 const file=packaged.get(sources[0]!)!.slice(1);
 expect(existsSync(path.resolve('public',file))||existsSync(path.resolve('services/app/public',file))).toBe(true);
});

it('names every packaged font file once with its hash stripped, so an /af/fonts/ name always means one set of bytes',()=>{
 const urls=[...new Set([...Object.values(manifest.families),manifest.app,...Object.values(manifest.systems)].flat().map(face=>face.url))];
 const byName=new Map<string,string>();
 for(const url of urls){const name=platformFontName(url);expect(name,url).not.toBeNull();expect(byName.get(name!)??url,`${name} names two files`).toBe(url);byName.set(name!,url);}
 // A fontsource upgrade that changes a file's bytes under the same name would make the immutable /af/fonts/ answer
 // stale in caches: rename that face (or drop the old name) instead. Compare against the last committed snapshot.
 expect(Object.fromEntries([...byName].sort().map(([name,url])=>[name,url.slice(-14,-6)]))).toMatchSnapshot();
});

it('gives exports only the active system and its fonts',()=>{
 const css=htmlSystemsCss(['redline']);
 expect(css).toContain(':root[data-af-design-system="redline"]');expect(css).not.toContain(':root[data-af-design-system="riso"]');
 expect(htmlSystemFontPaths(['redline']).length).toBeLessThan(htmlSystemFontPaths(HTML_SYSTEM_NAMES).length);
 expect(htmlSystemsCss(['unknown'])).not.toContain('@font-face');
});
