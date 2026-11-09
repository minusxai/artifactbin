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
import { withComponentGraph } from '../../services/app/scripts/server-reader-cache.mjs';

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
