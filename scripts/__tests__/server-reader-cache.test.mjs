/**
 * The server reader's `--cache` marker covers everything the component build read.
 *
 * main went red after #1180: a gate shard restored a test-builds cache whose marker was written by a FIRST build.
 * A first build has no earlier component receipt, so its marker stamped only the tools, the libraries and the
 * component sources, never the contracts and utils files the components import. The later edit to
 * services/contracts/src/agent.ts was invisible ("inputs unchanged, skipping rebuild") and component-baseline
 * failed on a stale build. The marker now also stamps the inputs of the receipt the build just wrote.
 */
import { describe, expect, it } from 'vitest';
import { lockedClosure, withComponentGraph } from '../../services/app/scripts/server-reader-cache.mjs';

describe('server reader cache marker', () => {
  it('stamps the inputs a first build discovered, so an edit to one is a miss', () => {
    const before = { inputs: { 'package-lock.json': [1, 1, 'a'] }, sources: 's' };
    const receipt = { inputs: [{ path: 'services/contracts/src/agent.ts', sha256: 'b'.repeat(64) }] };
    const after = withComponentGraph(before, receipt);
    expect(Object.keys(after.inputs)).toEqual(['package-lock.json', 'services/contracts/src/agent.ts']);
    expect(after.inputs['services/contracts/src/agent.ts'][2]).toBe('b'.repeat(64));
  });

  it('keeps the stamp taken before the build for an input it already had', () => {
    const before = { inputs: { 'services/contracts/src/agent.ts': [1, 1, 'pre-build'] }, sources: 's' };
    const receipt = { inputs: [{ path: 'services/contracts/src/agent.ts', sha256: 'post-build' }] };
    expect(withComponentGraph(before, receipt).inputs['services/contracts/src/agent.ts'][2]).toBe('pre-build');
  });

  it('ignores a receipt path outside the repository', () => {
    const before = { inputs: {}, sources: 's' };
    expect(withComponentGraph(before, { inputs: [{ path: '../outside.ts', sha256: 'c' }] }).inputs).toEqual({});
  });
});

// A lock change outside the hosted libraries' packages rebuilt them in every pr fast test runner (runs 43024170368 and
// 43027943712: ~7.5s each, both over the 60s clock). Their marker stamps only the lock entries they reach.
describe('the hosted libraries\' lock digest', () => {
  const lock = {
    packages: {
      '': { name: 'root' },
      'node_modules/vega': { version: '6.3.1', integrity: 'v', dependencies: { 'd3-format': '^3' } },
      'node_modules/d3-format': { version: '3.1.0', integrity: 'd' },
      'node_modules/three': { version: '0.185.1', integrity: 't' },
      'services/app/node_modules/vega-util': { version: '2.1.3', integrity: 'u', dependencies: { 'd3-format': '^2' } },
      'services/app/node_modules/vega-util/node_modules/d3-format': { version: '2.0.0', integrity: 'd2' },
      'node_modules/@artifactbin/contracts': { resolved: 'services/contracts', link: true },
      'services/contracts': { version: '0.1.0', dependencies: { zod: '^4' } },
      'node_modules/zod': { version: '4.0.0', integrity: 'z' },
      'node_modules/typescript': { version: '5.9.0', integrity: 'ts' },
    },
  };
  const roots = ['vega', 'vega-util', '@artifactbin/contracts', 'node:fs'];
  const changed = (location, version) => ({ packages: { ...lock.packages, [location]: { ...lock.packages[location], version } } });

  it('ignores a package the libraries cannot reach', () => {
    expect(lockedClosure(roots, changed('node_modules/typescript', '6.0.0'))).toBe(lockedClosure(roots, lock));
    expect(lockedClosure(roots, changed('node_modules/three', '0.186.0'))).toBe(lockedClosure(roots, lock));
  });

  it('changes with any package they reach: a root, a hoisted or nested dependency, a workspace link\'s dependency', () => {
    for (const location of ['node_modules/vega', 'node_modules/d3-format', 'services/app/node_modules/vega-util/node_modules/d3-format', 'node_modules/zod']) {
      expect(lockedClosure(roots, changed(location, '9.9.9')), location).not.toBe(lockedClosure(roots, lock));
    }
  });
});
