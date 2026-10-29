/** html-systems' remaining doors: the stylesheet address, the owner's saved choice, the font files and the offline style. */
import {expect,it} from 'vitest';
import {HTML_SYSTEM_NAMES,PLATFORM_STYLES_PATH,designSystemChoice,htmlSystemFontPaths} from '../index';
import {platformFontResponse,withOfflineSystemStyle} from '../server';

it('serves the platform stylesheet at one unversioned address',()=>{
 expect(PLATFORM_STYLES_PATH).toBe('/af/styles.css');
});

it('reads the owner choice only when it names an HTML system',()=>{
 for(const name of HTML_SYSTEM_NAMES)expect(designSystemChoice({theme:name})).toBe(name);
 for(const meta of [null,undefined,'volta',['volta'],{},{theme:'nope'},{theme:'Volta'},{theme:'__proto__'},{theme:'toString'},{theme:7}])expect(designSystemChoice(meta)).toBeNull();
});

it('answers a registered font immutably, by bare name or platform path, and HEAD without a body',async()=>{
 const fontPath=htmlSystemFontPaths(['volta'])[0]!;
 const name=fontPath.split('/').at(-1)!;
 const response=platformFontResponse(new Request(`https://app.test${fontPath}`),name);
 expect(response.status).toBe(200);
 expect(Object.fromEntries(response.headers)).toMatchObject({'content-type':'font/woff2','cache-control':'public, max-age=31536000, immutable','access-control-allow-origin':'*','x-content-type-options':'nosniff'});
 const bytes=new Uint8Array(await response.arrayBuffer());
 expect(bytes.byteLength).toBe(Number(response.headers.get('content-length')));
 expect(new TextDecoder().decode(bytes.slice(0,4))).toBe('wOF2');
 const head=platformFontResponse(new Request(`https://app.test${fontPath}`,{method:'HEAD'}),fontPath);
 expect(head.status).toBe(200);
 expect(head.headers.get('content-length')).toBe(String(bytes.byteLength));
 expect(await head.text()).toBe('');
});

it('refuses unregistered, traversal and malformed font names with an uncached 404',async()=>{
 for(const name of ['missing.woff2','../package.json','..%2Fpackage.json','/af/fonts/../../package.json','Archivo.woff2','font.ttf','','名前.woff2']){
  const response=platformFontResponse(new Request('https://app.test/af/fonts/x'),name);
  expect(response.status,name).toBe(404);
  expect(response.headers.get('cache-control')).toBe('no-store');
 }
});

it('inlines only the resolved system and admits its font bytes; a page without one is unchanged',()=>{
 const plain='<!doctype html><html><head><title>t</title></head><body>é</body></html>';
 expect(withOfflineSystemStyle(plain,'https://app.test/a/x/download')).toEqual({html:plain,resources:[]});
 const page='<!doctype html><html><head><meta name="artifactbin:design-system" content="volta"><title>t</title></head><body>☕</body></html>';
 const styled=withOfflineSystemStyle(page,'https://app.test/a/x/download');
 expect(styled.html).toMatch(/^<!DOCTYPE html><html><head><style data-af="platform-styles">/);
 expect(styled.html).toContain(':root[data-af-design-system="volta"]');
 expect(styled.html).not.toContain(':root[data-af-design-system="phosphor"]');
 expect(styled.html).toContain('<body>☕</body>');
 expect(styled.resources.length).toBeGreaterThan(0);
 for(const resource of styled.resources){
  expect(resource.url).toMatch(/^https:\/\/app\.test\/af\/fonts\/[a-z0-9-]+\.woff2$/);
  expect(resource.contentType).toBe('font/woff2');
  expect(resource.bytes.byteLength).toBeGreaterThan(0);
 }
 // The owner's saved choice outranks the page's own meta.
 const chosen=withOfflineSystemStyle(page,'https://app.test/','phosphor').html;
 expect(chosen).toContain(':root[data-af-design-system="phosphor"]');
 expect(chosen).not.toContain(':root[data-af-design-system="volta"] {');
});
