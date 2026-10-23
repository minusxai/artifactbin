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
