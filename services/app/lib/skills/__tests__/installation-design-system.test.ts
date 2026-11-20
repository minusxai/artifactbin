/**
 * The skill a server with an installation design system (APP__DESIGN_SYSTEM_DIR) serves: SKILL.md lists it first as
 * this server's default and has agents use it unless the user names another, and the archive carries its stylesheet.
 * Without one, SKILL.md keeps today's rule and table.
 */
import {afterEach,expect,it,onTestFinished} from 'vitest';
import {overrideConfig} from '@/lib/platform/config';
import {setDefaultHtmlSystem,setInstallationDesignSystem} from '@/lib/html-systems';
import {installDesignSystemFromSettings} from '@/lib/html-systems/server';
import {readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {tempDirSync} from '@artifactbin/test-support/temp-dir';
import {skillPackageFiles} from '../package';
import {renderTree} from '../serve';
import {SKILL_MAIN_MAX_BYTES,buildSkillTree,loadSkillSources} from '../tree';

afterEach(()=>{setInstallationDesignSystem(null);setDefaultHtmlSystem(null);overrideConfig({},{APP__DESIGN_SYSTEM_DIR:undefined,APP__DEFAULT_DESIGN_SYSTEM:undefined});});
const BASE='https://app.example.test';
const tree=()=>buildSkillTree(loadSkillSources());
const main=(shipped=false)=>renderTree(tree(),BASE,shipped).find(({file})=>file.path==='artifactbin/SKILL.md')!.text;
// The html-systems tests' Harbor fixture, read as files (lib/html-systems/__tests__/fixtures/harbor).
const HARBOR=path.resolve(import.meta.dirname,'../../html-systems/__tests__/fixtures/harbor');
const harborSpec=()=>JSON.parse(readFileSync(path.join(HARBOR,'system.json'),'utf8')) as {tokens:Array<Record<string,string>>};
const lightOnly=()=>{const spec=harborSpec();spec.tokens=spec.tokens.map(({dark:_dark,...rest})=>rest);return spec;};
const install=(spec:unknown=harborSpec(),name?:string)=>{
 const dir=tempDirSync('design-system-',onTestFinished);
 writeFileSync(path.join(dir,'system.json'),JSON.stringify(spec));
 writeFileSync(path.join(dir,'harbor-sans.woff2'),readFileSync(path.join(HARBOR,'harbor-sans.woff2')));
 overrideConfig({},{APP__DESIGN_SYSTEM_DIR:dir,APP__DEFAULT_DESIGN_SYSTEM:name});installDesignSystemFromSettings();
};
const RULE=(slug:string)=>`If no starter fits, write the page yourself. Use this server's default design system, \`${slug}\` (marked in the table), unless the user names another: set the starter's \`<meta name="artifactbin:design-system" content="NAME">\` to it, or to the name they chose; the other systems stay available (the platform serves its stylesheet and fonts). Keep viewer-local`;
const GRAPHITE='  | `graphite` | Quiet, Analytical | Analytics apps, internal apps and tools |\n';

it('without the setting keeps the starter\'s system rule and the built-in table',()=>{
 const text=main();
 expect(text).toContain('If no starter fits, write the page yourself. Keep the starter\'s design system unless the user names one; then set its `<meta name="artifactbin:design-system" content="NAME">` to a name from the table (the platform serves its stylesheet and fonts). Keep viewer-local');
 expect(text).not.toContain('this server\'s default');
 expect(text).toContain('|---|---|---|\n  | `volta` |');
 expect(skillPackageFiles(tree(),BASE)).not.toHaveProperty('design-systems/harbor.css');
});

it('with it lists the system first, marked as this server\'s default, to use unless the user names another',()=>{
 install();
 for(const text of [main(),main(true)]){
  expect(text).toContain(RULE('harbor'));expect(text).toContain(GRAPHITE);
  expect(text).not.toContain('Keep the starter\'s design system');
  expect(text).toContain('|---|---|---|\n  | `harbor` | Calm | This server\'s default (Harbor): Reports, dashboards and internal tools |\n  | `volta` |');
  expect(Buffer.byteLength(text)).toBeLessThanOrEqual(SKILL_MAIN_MAX_BYTES);
 }
 const files=skillPackageFiles(tree(),BASE),css=files['design-systems/harbor.css']!;
 expect(css).toContain('<meta name="artifactbin:design-system" content="harbor">');
 expect(css).toContain(':root[data-af-design-system="harbor"] {\n  --ds-canvas: #FFFFFF; /* Page ground. */');
 expect(css).toMatch(/src: url\("\/af\/fonts\/harbor-harbor-sans-[a-f0-9]{8}\.woff2"\)/);
 expect(files).toHaveProperty('design-systems/graphite.css');
});

it('stays within SKILL.md\'s cap with every table field at its longest',()=>{
 install({...harborSpec(),slug:`h${'a'.repeat(63)}`,name:'N'.repeat(40),mood:'M'.repeat(80),jobs:'J'.repeat(80)});
 for(const text of [main(),main(true)])expect(Buffer.byteLength(text)).toBeLessThanOrEqual(SKILL_MAIN_MAX_BYTES);
});

it('marks a built-in named by APP__DEFAULT_DESIGN_SYSTEM in its own row, once, and lists the installation system unmarked',()=>{
 overrideConfig({},{APP__DEFAULT_DESIGN_SYSTEM:'graphite'});installDesignSystemFromSettings();
 for(const text of [main(),main(true)]){
  expect(text).toContain(RULE('graphite'));
  expect(text).toContain('  | `graphite` | Quiet, Analytical | This server\'s default (Graphite): Analytics apps, internal apps and tools |\n');
  expect(text.match(/`graphite`/g)).toHaveLength(2);
  expect(text).toContain('|---|---|---|\n  | `volta` |');
 }
 install(harborSpec(),'graphite');
 const text=main();
 expect(text).toContain(RULE('graphite'));
 expect(text).toContain('|---|---|---|\n  | `harbor` | Calm | Reports, dashboards and internal tools |\n  | `volta` |');
 expect(text).not.toContain('default (Harbor)');
 expect(skillPackageFiles(tree(),BASE)).toHaveProperty('design-systems/harbor.css');
});

it('says when the default is light-only',()=>{
 install(lightOnly());
 expect(main()).toContain('| `harbor` | Calm | This server\'s default (Harbor, light only): Reports, dashboards and internal tools |');
});
