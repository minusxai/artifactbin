import { describe, expect, it } from 'vitest';
import { assertFullTestCoverage, auditFastSource, classifyFastGraph, partitionFastTests } from '../lib/fast-test-policy.mjs';
const graph = (...imports) => ({ inputs: { 'module.ts': { imports: imports.map(path => ({ path, external: true, kind: 'import-statement' })) } } });
describe('fast test capability boundary', () => {
  it('admits pure module behavior with the test runner and crypto', () => {
    expect(classifyFastGraph(graph('vitest', 'node:crypto')).eligible).toBe(true);
  });
  it.each(['@electric-sql/pglite', 'playwright', 'node:child_process', 'node:net', 'node:http', 'isolated-vm', 'unknown-new-package'])('rejects %s even in a transitive dependency', dependency => {
    expect(classifyFastGraph(graph(dependency)).eligible).toBe(false);
  });
  it('rejects graph edges that could not be resolved', () => {
    expect(classifyFastGraph({inputs:{'test.ts':{imports:[{path:'runtime-choice',external:true,kind:'dynamic-import'}]}}}).eligible).toBe(false);
  });
  it('keeps every discovered test in full coverage while only enrolled tests run fast', () => {
    const full = ['pure.test.ts', 'database.test.ts', 'new.test.ts'];
    expect(partitionFastTests(full, ['pure.test.ts'])).toEqual({fast:['pure.test.ts'],full});
    expect(() => partitionFastTests(full, ['removed.test.ts'])).toThrow(/missing/);
    expect(() => partitionFastTests(full, ['pure.test.ts','pure.test.ts'])).toThrow(/duplicate/);
  });
});

describe('ambient capability audit', () => {
  it.each(['fetch("https://example.test")', 'globalThis.fetch("https://example.test")', 'new Worker("worker.js")', 'setTimeout(() => {}, 5000)', 'import(moduleName)', 'require(moduleName)', 'globalThis[capability]()', 'vi.importActual("service")', 'vi.importMock("service")'])('rejects %s', source => {
    expect(auditFastSource(source, 'transitive.ts')).not.toEqual([]);
  });
  it('allows comments, string fixtures and literal module imports', () => {
    expect(auditFastSource('// fetch()\nconst example = "fetch()"; import("./pure.ts");', 'pure.ts')).toEqual([]);
  });
});

describe('full-suite ownership', () => {
  it('rejects a retained or new file dropped from every full project', () => {
    expect(() => assertFullTestCoverage(['retained.test.ts', 'new.test.mjs'], ['retained.test.ts'])).toThrow('new.test.mjs');
    expect(() => assertFullTestCoverage(['heavy.test.ts'], [])).toThrow('heavy.test.ts');
  });
  it('recognizes the native CLI runner exactly, without hiding nested or differently named tests', () => {
    expect(() => assertFullTestCoverage(['services/cli/test/auth.test.ts'], [])).not.toThrow();
    expect(() => assertFullTestCoverage(['services/cli/test/nested/auth.test.ts'], [])).toThrow();
    expect(() => assertFullTestCoverage(['services/cli/test/auth.test.mjs'], [])).toThrow();
  });
});

describe('reviewed GraphQL resolver dispatch', () => {
  const dispatch = 'source[info.fieldName](args, contextValue, info)';
  it('permits only the bundled GraphQL default field resolver dispatch', () => {
    expect(auditFastSource(dispatch, 'node_modules/graphql/execution/execute.js')).toEqual([]);
    expect(auditFastSource(dispatch, 'node_modules/graphql/execution/execute.mjs')).toEqual([]);
    expect(auditFastSource('iterable[Symbol.asyncIterator]()', 'node_modules/graphql/execution/mapAsyncIterator.js')).toEqual([]);
    expect(auditFastSource('iterable[Symbol.asyncIterator]()', 'services/app/operation.ts')).not.toEqual([]);
    expect(auditFastSource(dispatch, 'services/app/operation.ts')).not.toEqual([]);
    expect(auditFastSource(dispatch, 'node_modules/unreviewed/execute.js')).not.toEqual([]);
  });
  it('keeps ambient capabilities and other computed calls forbidden in GraphQL', () => {
    expect(auditFastSource('fetch(url)', 'node_modules/graphql/execution/execute.js')).not.toEqual([]);
    expect(auditFastSource('globalThis[capability]()', 'node_modules/graphql/execution/execute.js')).not.toEqual([]);
  });
});


describe('reviewed presence clock ports', () => {
  const reader = 'services/app/lib/html-presence/reader-session.ts';
  const room = 'services/app/lib/html-presence/room.ts';
  it('admits only the injected clock receiver in the two pure presence models', () => {
    for (const file of [reader, room, reader.replaceAll('/', '\\')]) {
      expect(auditFastSource('ports.clock.setTimeout(flush, 75); ports.clock.setInterval(tick, 3000);', file)).toEqual([]);
    }
  });
  it('does not admit ambient timers or other receivers, even inside reviewed models', () => {
    for (const source of ['setTimeout(work,75)', 'globalThis.setTimeout(work,75)', 'ports.other.setTimeout(work,75)', 'ports.clock.fetch(url)', 'ports.clock[method](work,75)', 'new ports.clock.setTimeout(work,75)']) {
      expect(auditFastSource(source, reader)).not.toEqual([]);
    }
    expect(auditFastSource('ports.clock.setTimeout(work,75)', 'services/app/unreviewed.ts')).not.toEqual([]);
    expect(classifyFastGraph(graph('node:timers')).eligible).toBe(false);
  });
});


describe('fast project environment boundary', () => {
  it('rejects DOM project files even when their globals hide from the import graph', () => {
    expect(classifyFastGraph({inputs:{'services/app/view.ui.test.ts':{imports:[]}}}).eligible).toBe(false);
    expect(classifyFastGraph({inputs:{'services/app/model.test.ts':{imports:[]}}}).eligible).toBe(true);
  });
});

describe('reviewed CSS parser dispatch', () => {
  const grammarFiles = ['node/Feature.js', 'node/FeatureRange.js', 'node/Ratio.js', 'scope/default.js', 'atrule/import.js'].map(name => `node_modules/css-tree/lib/syntax/${name}`);
  it('admits CSS grammar functions and the two internal AST dispatch sites', () => {
    for (const file of grammarFiles) expect(auditFastSource('this.Function(this.readSequence, this.scope.Value)', file)).toEqual([]);
    expect(auditFastSource('this[name]()', 'node_modules/css-tree/lib/parser/create.js')).toEqual([]);
    expect(auditFastSource('iterators[node.type](node, context, walkNode, walkReducer)', 'node_modules/css-tree/lib/walker/create.js')).toEqual([]);
  });
  it('keeps executable constructors, ambient capabilities and unreviewed dispatch forbidden', () => {
    for (const source of ['Function("return 1")', 'new Function("return 1")', 'globalThis.Function("return 1")', 'other.Function()', 'new this.Function()', 'fetch(url)', 'this.Function(fetch(url))']) {
      for (const file of grammarFiles) expect(auditFastSource(source, file)).not.toEqual([]);
    }
    expect(auditFastSource('this.Function()', 'services/app/parser.ts')).not.toEqual([]);
    expect(auditFastSource('this[other]()', 'node_modules/css-tree/lib/parser/create.js')).not.toEqual([]);
    expect(auditFastSource('this[name](argument)', 'node_modules/css-tree/lib/parser/create.js')).not.toEqual([]);
    expect(auditFastSource('iterators[node.type](url)', 'node_modules/css-tree/lib/walker/create.js')).not.toEqual([]);
    expect(auditFastSource('globalThis[capability]()', 'node_modules/css-tree/lib/walker/create.js')).not.toEqual([]);
    expect(auditFastSource('iterators[node.type](node, context, walkNode, walkReducer)', 'services/app/walker.ts')).not.toEqual([]);
  });
});

describe('reviewed query request port', () => {
  const file='services/app/lib/html-runtime/apollo/watch-query.ts';
  it('admits only the no-argument request callback injected into the pure watch model', () => {
    for(const path of [file,file.replaceAll('/', '\\')]) {
      expect(auditFastSource('options.remote!.fetch()',path)).toEqual([]);
      expect(auditFastSource('options.remote.fetch()',path)).toEqual([]);
    }
  });
  it('continues rejecting ambient transport and other capability receivers', () => {
    for(const source of ['fetch(url)','globalThis.fetch(url)','options.fetch()','other.remote.fetch()','options.other.fetch()','options.remote!.fetch(url)','options.remote![method]()','new options.remote!.fetch()','options.remote!.fetch(fetch(url))']) {
      expect(auditFastSource(source,file)).not.toEqual([]);
    }
    expect(auditFastSource('options.remote!.fetch()','services/app/unreviewed.ts')).not.toEqual([]);
  });
});
