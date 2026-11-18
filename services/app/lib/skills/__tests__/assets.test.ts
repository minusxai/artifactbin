import {mkdirSync,writeFileSync,symlinkSync} from 'node:fs';
import path from 'node:path';
import {expect,it,onTestFinished} from 'vitest';
import {loadSkillAssets,skillAssetName} from '../assets';
import {tempDirSync} from '@artifactbin/test-support/temp-dir';
function fixture(files:Record<string,string>){
 const root=tempDirSync('skill-assets-',onTestFinished);
 for(const [name,source] of Object.entries(files)){const file=path.join(root,name);mkdirSync(path.dirname(file),{recursive:true});writeFileSync(file,source);}
 return root;
}
it('packages readable component sources alongside existing assets; compiled modules are hosted, never packaged',()=>{
 const files={'components/button.ts':'export interface ButtonProps {}','scripts/preview-server.mjs':'export {};','examples/page.html':'<p>Example</p>','design-systems/plain.css':':root{}'};
 expect(loadSkillAssets(fixture(files))).toEqual(files);
 expect(skillAssetName('components/button.ts')).toBe(true);expect(skillAssetName('components/button.js')).toBe(false);expect(skillAssetName('components/chunk-abc123.js')).toBe(false);
 expect(()=>loadSkillAssets(fixture({...files,'components/button.js':'customElements.define("af-button", class extends HTMLElement {});'}))).toThrow('Unsupported skill asset: components/button.js');
});
it('excludes component test and fixture sources from installed packages',()=>{
 expect(loadSkillAssets(fixture({'components/button.ts':'source','components/button.test.ts':'test','components/button.fixture.ts':'fixture'}))).toEqual({'components/button.ts':'source'});
 expect(skillAssetName('components/button.test.ts')).toBe(false);expect(skillAssetName('components/button.fixture.ts')).toBe(false);
});
it.each(['components/.env','components/secrets.json','components/button.test.js','components/nested/button.ts','components/Button.ts','scripts/unexpected.js'])('rejects unsupported package contents: %s',name=>{
 expect(()=>loadSkillAssets(fixture({[name]:'private'}))).toThrow('Unsupported skill asset:');
});
it('does not follow a component symlink outside the package',()=>{
 const root=fixture({'components/button.ts':'source'}),outside=fixture({'private.ts':'private'});
 symlinkSync(path.join(outside,'private.ts'),path.join(root,'components/leak.ts'));
 expect(()=>loadSkillAssets(root)).toThrow('Unsupported skill asset:');
});
it('preserves packages without a components directory',()=>{
 expect(loadSkillAssets(fixture({'examples/page.html':'<p>Example</p>'}))).toEqual({'examples/page.html':'<p>Example</p>'});
});
