/** The run-time spec → CSS port (../system-css) is the build generator's code path: byte for byte, every built-in. */
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {expect,it} from 'vitest';
import {HTML_SYSTEMS} from '../html-systems';
import {specRules,specStylesheet,specVars,type DesignSystemSpec} from '../system-css';

const SPECS=path.resolve('../../design-systems/specs'),SHEETS=path.resolve('skills/artifactbin/design-systems');
const spec=(slug:string)=>JSON.parse(readFileSync(path.join(SPECS,`${slug}.json`),'utf8')) as DesignSystemSpec;
const MARK='\n/* Font faces: the platform hosts these files; they stay here so the sheet is complete on its own. */\n';

it('writes every built-in system\'s platform rules exactly as the generated registry holds them',()=>{
 expect(Object.keys(HTML_SYSTEMS)).toHaveLength(14);
 for(const [slug,system] of Object.entries(HTML_SYSTEMS))expect(specRules(spec(slug)),slug).toBe(system.rules);
});

it('writes every built-in system\'s shipped stylesheet exactly as the skill carries it',()=>{
 for(const slug of Object.keys(HTML_SYSTEMS)){
  const shipped=readFileSync(path.join(SHEETS,`${slug}.css`),'utf8'),faces=shipped.slice(shipped.indexOf(MARK)+MARK.length,-1);
  expect(specStylesheet(spec(slug),faces),slug).toBe(shipped);
 }
});

it('emits an explicit radius scale after --radius, and only the steps a spec sets',()=>{
 const base=spec('graphite'),vars=specVars({...base,radius_scale:{md:'100px',lg:'15px'}},'light');
 const keys=Object.keys(vars);
 expect(keys.slice(keys.indexOf('--radius'),keys.indexOf('--radius')+3)).toEqual(['--radius','--radius-md','--radius-lg']);
 expect(vars['--radius-md']).toBe('100px');expect(vars).not.toHaveProperty('--radius-sm');
 expect(specVars({...base,radius_scale:{md:'100px'}},'dark')).not.toHaveProperty('--radius-md');
});

it('locks a spec without dark values to light: its dark block repeats the light palette and holds the scheme',()=>{
 const base=spec('graphite'),light={...base,tokens:base.tokens.map(({dark:_dark,...token})=>token)};
 const rules=specRules(light);
 expect(specVars(light,'dark')['--ds-canvas']).toBe(specVars(light,'light')['--ds-canvas']);
 expect(rules).toContain(':root[data-af-design-system="graphite"][data-af-dark="true"] { color-scheme: light !important; }');
 expect(specRules(base)).not.toContain('color-scheme');
});
