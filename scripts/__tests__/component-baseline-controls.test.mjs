import { describe, expect, it } from 'vitest';
import {retainedComponentSource} from '../fixtures/component-baseline/source-provenance.mjs';
import { createHash } from 'node:crypto';
import { readFile, mkdtemp, cp, rm } from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import { build } from 'esbuild';
import ts from 'typescript';
import { JSDOM } from 'jsdom';
import { controlBaselineFixtures } from '../fixtures/component-baseline/controls.mjs';

const repo=path.resolve(import.meta.dirname,'../..');

describe('retained control baseline provenance and authored scenarios',()=>{
  it('uses eight actual public original component exports at the recorded revision',()=>{
    expect(controlBaselineFixtures.map(f=>f.family).sort()).toEqual(['Accordion','Collapsible','Input','Popover','Segmented','Slider','Switch','Textarea']);
    const sources=new Map();
    for(const fixture of controlBaselineFixtures){
      const {revision,path:sourcePath,sha256,exports:names}=fixture.provenance;
      const key=`${revision}:${sourcePath}`;
      if(!sources.has(key))sources.set(key,retainedComponentSource({revision,path:sourcePath,sha256}));
      const source=sources.get(key);
      expect(createHash('sha256').update(source).digest('hex')).toBe(sha256);
      for(const name of names){
        expect(source).toMatch(new RegExp(`export (?:function|const) ${name}\\b`));
        expect(fixture.oldJsx).toMatch(new RegExp(`<${name}(?:\\s|>)`));
      }
      const parsed=ts.createSourceFile(`${fixture.id}.tsx`,`const page=<>${fixture.oldJsx}</>`,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
      expect(parsed.parseDiagnostics).toEqual([]);
    }
  });
  it('verifies exact retained source without any repository history',async()=>{
    const directory=await mkdtemp(path.join(tmpdir(),'retained-component-source-'));
    try{
      for(const entry of ['source-provenance.mjs','retained-source'])await cp(path.join(repo,'scripts/fixtures/component-baseline',entry),path.join(directory,entry),{recursive:true});
      const {retainedComponentSource:readSource}=await import(pathToFileURL(path.join(directory,'source-provenance.mjs')).href);
      const proof=controlBaselineFixtures[0].provenance;
      expect(createHash('sha256').update(readSource(proof)).digest('hex')).toBe(proof.sha256);
    }finally{await rm(directory,{recursive:true,force:true});}
  });
  it('refuses unknown revisions, source paths and mismatched source commitments',()=>{
    const proof=controlBaselineFixtures[0].provenance;
    for(const changed of [{...proof,revision:'0'.repeat(40)},{...proof,path:'../current-source.tsx'},{...proof,sha256:'f'.repeat(64)}])expect(()=>retainedComponentSource(changed)).toThrow('retained_component_source_unadmitted');
  });
  it('declares independent, unique capture states within the existing action contract',()=>{
    expect(new Set(controlBaselineFixtures.map(f=>f.id)).size).toBe(8);
    for(const fixture of controlBaselineFixtures){
      expect(fixture.states[0]).toMatchObject({id:'initial',actions:[]});
      expect(fixture.states.every(state=>state.expected?.roles?.length>0)).toBe(true);
      expect(new Set(fixture.states.map(s=>s.id)).size).toBe(fixture.states.length);
      expect(fixture.states.length).toBeGreaterThan(1);
      for(const {actions} of fixture.states)for(const action of actions){
        expect(['click','focus','press']).toContain(action.action);
        expect(action.name).not.toBe('');
        expect(action.role).not.toBe('');
        if(action.action==='press')expect(action.key).toBeTruthy();
      }
    }
  });
  it('bundles actual candidate registrations and setup without mocks or network transports',async()=>{
    const dom=new JSDOM('<!doctype html><html><head></head><body></body></html>',{runScripts:'outside-only'});
    const {window}=dom;const {document}=window;
    try {
    for(const fixture of controlBaselineFixtures){
      for(const module of fixture.modules){
        const source=await readFile(path.join(repo,'services/app/lib/html-components',module+'.ts'),'utf8');
        expect(source).toContain(`export function register${module.split('-').map(word=>word[0].toUpperCase()+word.slice(1)).join('')}`);
      }
      const contents=fixture.modules.map(name=>`import {register${name[0].toUpperCase()+name.slice(1)}} from './services/app/lib/html-components/${name}.ts';register${name[0].toUpperCase()+name.slice(1)}();`).join('\n')+'\n'+(fixture.setup??'');
      const result=await build({stdin:{contents,resolveDir:repo},bundle:true,write:false,format:'iife',platform:'browser'});
      document.body.innerHTML=fixture.newHtml;
      // Execute the exact registered component bundle, not an HTML surrogate.
      window.eval(result.outputFiles[0].text);
      expect(document.querySelector(fixture.newHtml.match(/<(af-[\w-]+)/)[1])).not.toBeNull();
      expect(result.outputFiles[0].text).not.toContain('fetch(');
      const host=document.querySelector(`af-${fixture.id}`);
      if(['input','textarea','slider'].includes(fixture.id)){
        const field=host.querySelector('input,textarea');
        const value=fixture.id==='slider'?'50':fixture.id==='textarea'?'Review details\nx':'Adax';
        field.value=value;field.dispatchEvent(new window.Event('input',{bubbles:true}));
        expect(host.value).toBe(fixture.id==='slider'?50:value);
        expect(document.querySelector(`af-${fixture.id}[disabled] input,af-${fixture.id}[disabled] textarea`).value).toBe(fixture.id==='slider'?'40':fixture.id==='textarea'?'Review details':'Ada');
      } else if(fixture.id==='switch'){
        host.querySelector('button').click();
        expect(host.checked).toBe(true);
        expect(host.querySelector('button').getAttribute('aria-checked')).toBe('true');
        expect(document.querySelector('af-switch[disabled] button').getAttribute('aria-checked')).toBe('false');
      } else if(fixture.id==='accordion'){
        const buttons=host.querySelectorAll('button');buttons[1].click();
        expect(buttons[0].getAttribute('aria-expanded')).toBe('false');
        expect(buttons[1].getAttribute('aria-expanded')).toBe('true');
        expect(buttons[2].disabled).toBe(true);
      } else if(fixture.id==='collapsible'||fixture.id==='popover'){
        const trigger=host.querySelector('button');trigger.click();
        expect(trigger.getAttribute('aria-expanded')).toBe('true');
        trigger.click();expect(trigger.getAttribute('aria-expanded')).toBe('false');
      }
    }
    const input=controlBaselineFixtures.find(f=>f.id==='input');
    document.body.innerHTML=input.newHtml;
    expect(document.querySelector('af-input input').value).toBe('Ada');
    expect(document.querySelector('af-input[disabled] input').disabled).toBe(true);
    const segmented=controlBaselineFixtures.find(f=>f.id==='segmented');
    document.body.innerHTML=segmented.newHtml;window.eval(segmented.setup);
    const later=[...document.querySelectorAll('af-segmented button')].find(node=>node.textContent==='Later');
    later.click();
    expect(later.getAttribute('aria-pressed')).toBe('true');
    } finally {dom.window.close();}
  });
});
