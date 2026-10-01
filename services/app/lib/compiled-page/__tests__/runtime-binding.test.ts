/** Binding a stored page to the live runtime (runtime-binding.ts): which specifiers are rewritten, what is missing, and the preload closure. */
import { describe, expect, it } from 'vitest';
import type { CompilerBuild, ModuleRef } from '../contract';
import { bindModule, bindModuleCode, bindModuleRef, preloadClosure, unresolvedSpecifiers } from '../runtime-binding';

const build: CompilerBuild = {
  id: 'abcdef0123456789',
  manifest: { '@mx/rt': '/islands/rt-1.js', '@mx/boot': '/islands/boot-2.js', '@mx/kit/tabs': '/islands/tabs-3.js', 'solid-js/web': '/islands/web-4.js' },
  // A diamond (boot and tabs both reach rt → web), a cycle, and a chunk no file lists.
  graph: {
    '/islands/rt-1.js': ['/islands/web-4.js'],
    '/islands/boot-2.js': ['/islands/rt-1.js', '/islands/shared-5.js'],
    '/islands/tabs-3.js': ['/islands/rt-1.js', '/islands/shared-5.js'],
    '/islands/web-4.js': [],
    '/islands/shared-5.js': ['/islands/tabs-3.js', '/islands/orphan-6.js'],
  },
};

describe('bindModule', () => {
  it('rewrites only quoted shared specifiers the build knows and leaves every other byte identical', () => {
    const code = `import{a}from"@mx/rt";import{b}from'@mx/kit/tabs';import"solid-js/web";const s="see @mx/rt",t='plain',u=@mx/rt;const v="./local.js";`;
    const { code: bound, missing } = bindModule(code, build);
    expect(bound).toBe(`import{a}from"/islands/rt-1.js";import{b}from'/islands/tabs-3.js';import"/islands/web-4.js";const s="see @mx/rt",t='plain',u=@mx/rt;const v="./local.js";`);
    expect(missing).toEqual([]);
    expect(bindModuleCode(code, build)).toBe(bound);
  });

  it('reports exactly the unresolved specifiers, once each, and leaves them in place', () => {
    const code = `import"@mx/kit/gone";import"@mx/kit/gone";import"solid-js/store";import"@mx/boot";`;
    const { code: bound, missing } = bindModule(code, build);
    expect(missing.sort()).toEqual(['@mx/kit/gone', 'solid-js/store']);
    expect(bound).toBe(`import"@mx/kit/gone";import"@mx/kit/gone";import"solid-js/store";import"/islands/boot-2.js";`);
  });

  it('leaves a module that already names chunk URLs unchanged', () => {
    const code = `import"/islands/rt-1.js";`;
    expect(bindModule(code, build)).toEqual({ code, missing: [] });
  });
});

describe('unresolvedSpecifiers', () => {
  it('is the ref specifiers the build cannot resolve; none for a null ref or one without specifiers', () => {
    const ref: ModuleRef = { sha: 'a'.repeat(64), url: '/islands/d/x.js', bytes: 1, imports: [], specifiers: ['@mx/rt', '@mx/kit/gone'] };
    expect(unresolvedSpecifiers(ref, build)).toEqual(['@mx/kit/gone']);
    expect(unresolvedSpecifiers(null, build)).toEqual([]);
    expect(unresolvedSpecifiers({ ...ref, specifiers: undefined }, build)).toEqual([]);
  });
});

describe('preloadClosure', () => {
  it('is the transitive closure over build.graph, starting URLs first, each URL once', () => {
    expect(preloadClosure(build, ['/islands/boot-2.js'])).toEqual(['/islands/boot-2.js', '/islands/rt-1.js', '/islands/web-4.js', '/islands/shared-5.js', '/islands/tabs-3.js', '/islands/orphan-6.js']);
    expect(preloadClosure(build, ['/islands/web-4.js', '/islands/web-4.js'])).toEqual(['/islands/web-4.js']);
  });
  it('keeps the direct URLs when the build carries no graph', () => {
    expect(preloadClosure({ id: build.id, manifest: build.manifest }, ['/islands/rt-1.js', '/islands/boot-2.js'])).toEqual(['/islands/rt-1.js', '/islands/boot-2.js']);
  });
});

describe('bindModuleRef', () => {
  const ref: ModuleRef = { sha: 'a'.repeat(64), url: '/islands/d/abc.js', bytes: 1, imports: ['/stale.js'], specifiers: ['@mx/kit/tabs', '@mx/kit/gone'] };
  it('appends ?b=<build id> and replaces imports with the closure of the resolvable specifiers', () => {
    const bound = bindModuleRef(ref, build);
    expect(bound.url).toBe('/islands/d/abc.js?b=abcdef0123456789');
    expect(bound.imports).toEqual(preloadClosure(build, ['/islands/tabs-3.js']));
    expect(bound.imports).toEqual(['/islands/tabs-3.js', '/islands/rt-1.js', '/islands/web-4.js', '/islands/shared-5.js', '/islands/orphan-6.js']);
    expect({ ...bound, url: ref.url, imports: ref.imports }).toEqual(ref);
  });
  it('returns a ref without specifiers unchanged', () => {
    const legacy: ModuleRef = { sha: 'b'.repeat(64), url: '/islands/d/old.js', bytes: 1, imports: ['/islands/rt-1.js'] };
    expect(bindModuleRef(legacy, build)).toBe(legacy);
  });
});
