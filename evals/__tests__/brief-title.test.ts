/**
 * A task that GATES `has_title` must say what a title IS.
 *
 * artifact-bin has two different things an author can call a title: the document's
 * `<title>` (what a browser tab and a link preview show) and an on-page `<h1>`.
 * An agent told a document is "titled X" often writes the heading and leaves the
 * document titled `artifact` — which is exactly how the `mcp` smoke task failed
 * master while publishing correctly over MCP (9 writes, version 10, no title).
 *
 * The comparison briefs already learned this and each says WHERE the title shows
 * up — "what a browser tab and a shared link preview show". `mcp` said only
 * `titled "Hello over MCP"` and was the one that failed. The guard asserts the
 * idea, not one sentence: the briefs word it differently and are free to, but a
 * task may not GATE a title without telling the agent which title it means.
 */
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { discoverTasks } from '../lib/task-set';

const tasks = discoverTasks(path.resolve(__dirname, '..', 'tasks'));

describe('every task that gates has_title', () => {
  const gating = tasks.filter((t) => t.task.checks.includes('has_title'));

  it('there is at least one, or this guard is vacuous', () => {
    expect(gating.length).toBeGreaterThan(0);
  });

  it.each(gating.map((t) => t.id))('%s says where the title shows, so it cannot be read as the on-page heading', (id) => {
    const brief = gating.find((t) => t.id === id)!.task.brief;
    expect(brief.toLowerCase()).toContain('browser tab');
  });
});
