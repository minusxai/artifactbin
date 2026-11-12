/** Repository guard for the hosted modules used by rich fixtures; CI runs this
 * without building browser assets or launching engines. */
import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {richFamilies,richFixtureHtml} from '../lib/html-rich-components-fixture.mjs';
import {richBrowserParityFixtures} from '../fixtures/component-baseline/rich.mjs';

it('every rich fixture import names a currently hosted component',()=>{
 const {components}=JSON.parse(readFileSync(new URL('../../services/app/lib/html-components/hosted.json',import.meta.url),'utf8'));
 const fixtureImports=[...richFixtureHtml().matchAll(/import '\/components\/([^']+)\.js'/g)].map(match=>match[1]);
 expect(fixtureImports).toEqual(richFamilies.map(([,module])=>module));
 for(const module of [...fixtureImports,...richBrowserParityFixtures.flatMap(fixture=>fixture.modules)]){
  expect(components,`rich fixture requires nonexistent hosted component ${module}`).toContain(module);
 }
});
