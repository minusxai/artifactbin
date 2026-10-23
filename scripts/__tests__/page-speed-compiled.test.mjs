// DESTINATION: scripts/__tests__/page-speed-compiled.test.mjs
/**
 * THE LAB MEASURES THE COMPILED READER (docs/phase2-architecture.md §11): the page-speed fixtures gain
 * the kitchen sink ("every component", target 2), the head build is measured with the compiled reader
 * on, and the size-target check sees every fixture it judges.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PAGE_SPEED_FIXTURES, publishPageSpeedFixtures } from '../fixtures/page-speed/index.mjs';
import { SIZE_TARGETS } from '../build/size-targets.mjs';

const root = path.resolve(import.meta.dirname, '../..');

describe('the fixtures', () => {
  it('include the kitchen sink, painted when its chart is drawn', () => {
    const kitchen = PAGE_SPEED_FIXTURES.find((f) => f.key === 'kitchen');
    expect(kitchen).toBeTruthy();
    expect(kitchen.painted).toEqual({ charts: 1 });
  });
  it('publish the kitchen sink\'s refs (dataset, recipe, image, pdf) before the document that names them', async () => {
    const bodies = [];
    await publishPageSpeedFixtures(async (body) => { bodies.push(body); return { id: `id${bodies.length}` }; });
    const kitchen = bodies.find((b) => b.title === 'Perf G kitchen sink');
    expect(kitchen).toBeTruthy();
    const index = bodies.indexOf(kitchen);
    expect(bodies.slice(0, index).some((b) => b.image)).toBe(true);
    expect(bodies.slice(0, index).some((b) => b.pdf)).toBe(true);
    expect(kitchen.html).toContain('<!doctype html>');
    expect(kitchen.html).not.toContain('{{');
    expect(kitchen).not.toHaveProperty('markup');
  });
  it('are every fixture the size targets judge', () => {
    const keys = new Set(PAGE_SPEED_FIXTURES.map((f) => f.key));
    for (const target of SIZE_TARGETS) for (const key of [...target.fixtures, ...target.optional]) expect(keys.has(key), key).toBe(true);
  });
});

describe('the lab run', () => {
  const loads = readFileSync(path.join(root, 'scripts/ci/performance-loads.mjs'), 'utf8');
  it('boots the measured server without a legacy reader switch, so the head measures Phase 2', () => {
    expect(loads).not.toContain('FLAG__COMPILED_READER');
  });
  it('the workflow judges the size targets on the head', () => {
    const workflow = readFileSync(path.join(root, '.github/workflows/page-speed.yml'), 'utf8');
    expect(workflow).toContain('node scripts/build/size-targets.mjs page-speed/head.json --markdown --strict');
  });
});

describe('native workload behavior', () => {
  it('draws dashboard charts from client state and filters their data when the region changes', async () => {
    const {JSDOM}=await import('jsdom');
    const {createClient,createLocalStore,gql}=await import('../../services/app/lib/html-runtime/apollo/client.ts');
    const bodies=[];
    await publishPageSpeedFixtures(async body=>{bodies.push(body);return {id:`id${bodies.length}`};});
    const html=bodies.find(body=>body.title==='Perf C dashboard').html;
    const {window}=new JSDOM(html);
    const state=JSON.parse(window.document.querySelector('[data-af="state"]').textContent);
    const client=createClient({backends:[],state:createLocalStore(state)});
    const authored=window.document.querySelector('script[type="module"]').textContent.replace("import {client,gql} from '@afbin/apollo';",'');
    await new Function('client','gql','document',`return (async()=>{${authored}})()`)(client,gql,window.document);
    expect(window.document.querySelectorAll('[data-af-chart="ready"]')).toHaveLength(2);
    expect(window.document.querySelectorAll('#charts rect')).toHaveLength(state.rows.length*2);
    const region=window.document.querySelector('#region');region.value=state.rows[0].region;
    await region.onchange({target:region});
    expect(window.document.querySelectorAll('#charts rect')).toHaveLength(state.rows.filter(row=>row.region===region.value).length*2);
    expect(window.document.documentElement.dataset.afReady).toBe('yes');
  });
});


it('waits for the actual document frame and ignores unrelated ready messages', async()=>{
 const {JSDOM}=await import('jsdom');
 const {documentViewProbe}=await import('../lib/document-views.mjs');
 const {window}=new JSDOM('<html><body><iframe data-mx-document-frame></iframe></body></html>',{url:'https://app.example.test'});
 window.__documentViewConfig={view:true,want:{charts:2}};
 new Function('window','document','performance','PerformanceObserver','MutationObserver','requestAnimationFrame',`(${documentViewProbe.toString()})()`)(window,window.document,window.performance,undefined,window.MutationObserver,fn=>fn());
 window.__documentView.check();
 window.dispatchEvent(new window.MessageEvent('message',{data:{type:'page-speed-native',ready:true},source:window}));
 expect(window.__documentView.takeover).toBeNull();
 const source=window.document.querySelector('iframe').contentWindow;
 window.dispatchEvent(new window.MessageEvent('message',{data:{type:'page-speed-native',ready:true,painted:true},source}));
 expect(window.__documentView.takeover).not.toBeNull();expect(window.__documentView.painted).not.toBeNull();
 window.close();
});
