/**
 * "Turns spent reading docs" — the metric that `docs_fetches` (an HTTP count)
 * could not see. Measured: a Claude Code dashboard run fetched four docs pages
 * in ONE turn (`curl … -o llms.txt`) and then spent 14 turns paging them with
 * `sed -n '100,420p' llms.txt` — 42% of the run, invisible to the ledger,
 * which read `docs_fetches: 1`.
 */
import { describe, it, expect } from 'vitest';
import { countDocsReads } from '../lib/docs-reads';
import { claudeCode } from '../lib/harness/claude-code';
import { pi } from '../lib/harness/pi';
import { opencode } from '../lib/harness/opencode';
import { codex } from '../lib/harness/codex';

const B = 'http://127.0.0.1:3100';

describe('countDocsReads (pure)', () => {
  it('counts a fetch of a docs URL, and every later read of the file it was saved to', () => {
    const n = countDocsReads([
      { name: 'bash', input: { command: `curl -s ${B}/llms.txt -o llms.txt && curl -s ${B}/docs/markup -o markup.txt` } },
      { name: 'bash', input: { command: "sed -n '100,420p' llms.txt" } },
      { name: 'bash', input: { command: "sed -n '1,99p' llms.txt; sed -n '420,700p' llms.txt" } },
      { name: 'bash', input: { command: "sed -n '1,240p' markup.txt" } },
      { name: 'bash', input: { command: 'ls -la && pwd' } },
      { name: 'bash', input: { command: 'head -50 support.csv' } },
    ]);
    expect(n).toBe(4);
  });
  it('counts a direct read of a docs URL (no file) and a Read tool on a saved docs file', () => {
    const n = countDocsReads([
      { name: 'bash', input: { command: `curl -s ${B}/docs/templates/dashboard | head -c 6000` } },
      { name: 'bash', input: { command: `curl -sS ${B}/docs/llm > /tmp/llm.md` } },
      { name: 'Read', input: { file_path: '/tmp/llm.md', offset: 100, limit: 200 } },
      { name: 'WebFetch', input: { url: `${B}/docs/artifact-design` } },
    ]);
    expect(n).toBe(4);
  });
  it('does not count publishing or the start link, even when the body mentions /docs', () => {
    const n = countDocsReads([
      { name: 'bash', input: { command: `curl -s -X POST ${B}/a/AbC123/start?k=xyz` } },
      { name: 'bash', input: { command: `curl -X PUT ${B}/api/artifacts/AbC123 --data-binary @doc.json` } },
      { name: 'bash', input: { command: `curl -X POST ${B}/api/artifacts -d '{"markup":"<p>see /docs/llm</p>"}'` } },
      { name: 'bash', input: { command: `curl -s ${B}/a/AbC123/raw` } },
    ]);
    expect(n).toBe(0);
  });
  it('is null-safe: no calls → 0', () => {
    expect(countDocsReads([])).toBe(0);
  });
  /**
   * Plugins mode: the docs are FILES under the plugin's `skills/` directory, not
   * URLs, so the production baseline read `docs_read_calls: 0` for every Claude
   * Code plugins run — blind exactly where the tree changes the most. A read of
   * a skill file, a grep across the skills directory, or Claude Code's own
   * `Skill` tool is a turn spent reading docs like any other.
   */
  it('counts reads of plugin skill files, greps across the skills directory, and the Skill tool', () => {
    const n = countDocsReads([
      { name: 'Read', input: { file_path: '/tmp/mx-plugin/plugins/artifact-bin/skills/markup/SKILL.md' } },
      { name: 'bash', input: { command: 'cat .opencode/skills/publish/SKILL.md' } },
      { name: 'bash', input: { command: "sed -n '1,120p' /Users/x/.pi/skills/artifact-bin/skills/design/SKILL.md" } },
      { name: 'bash', input: { command: 'grep -rl SlideDeck /tmp/mx-plugin/plugins/artifact-bin/skills/' } },
      { name: 'Skill', input: { skill: 'artifact-bin:publish' } },
      { name: 'bash', input: { command: 'ls -la && pwd' } },
      { name: 'bash', input: { command: 'cat support.csv' } },
      { name: 'Read', input: { file_path: '/tmp/work/deck.jsx' } },
    ]);
    expect(n).toBe(5);
  });
  /**
   * The tree the plugin ships is ONE skill over `references/`, so an installed
   * skill's detail files live at `skills/artifact-bin/references/<topic>.md` —
   * one level deeper than the flat layout this rule was written for. Every
   * reference read was uncounted: on a real plugins run the seven tasks
   * reported 7 docs reads where the transcripts hold 39 (pi) and 49 (OpenCode),
   * which is the whole metric on the mode it exists to measure.
   */
  it('counts a read of a reference file under an installed skill, at any depth', () => {
    const n = countDocsReads([
      { name: 'Read', input: { file_path: '/tmp/mx-plugin/plugins/artifact-bin/skills/artifact-bin/references/markup.md' } },
      { name: 'bash', input: { command: 'cat .opencode/skills/artifact-bin/references/publishing-datasets.md' } },
      { name: 'bash', input: { command: "sed -n '1,120p' /Users/x/.pi/skills/artifact-bin/references/design.md" } },
      { name: 'Read', input: { file_path: '/tmp/mx-plugin/plugins/artifact-bin/skills/artifact-bin/SKILL.md' } },
      { name: 'bash', input: { command: 'cat support.csv' } },
    ]);
    expect(n).toBe(4);
  });
  it('a write to the product never counts, even from a skills directory', () => {
    expect(countDocsReads([
      { name: 'bash', input: { command: `curl -X PUT ${B}/api/artifacts/AbC123 --data-binary @skills/markup/doc.json` } },
    ])).toBe(0);
  });
});

describe('each adapter reports docsReadCalls from its own event shape', () => {
  it('claude-code: assistant tool_use inputs', () => {
    const lines = [
      { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: `curl -s ${B}/docs/llm -o llms.txt` } }] } },
      { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: "sed -n '1,200p' llms.txt" } }, { type: 'tool_use', name: 'Bash', input: { command: 'ls' } }] } },
      { type: 'result', subtype: 'success', is_error: false, result: 'done', num_turns: 3, usage: {} },
    ];
    expect(claudeCode.reduce(lines.map((l) => JSON.stringify(l)).join('\n')).docsReadCalls).toBe(2);
  });
  it('pi: assistant toolCall arguments', () => {
    const lines = [
      { type: 'message_end', message: { role: 'assistant', content: [{ type: 'toolCall', name: 'bash', arguments: { command: `curl -s ${B}/docs/markup -o markup.txt` } }], usage: {} } },
      { type: 'message_end', message: { role: 'assistant', content: [{ type: 'toolCall', name: 'bash', arguments: { command: 'cat markup.txt' } }, { type: 'text', text: 'ok' }], usage: {}, stopReason: 'stop' } },
      { type: 'turn_end' },
    ];
    expect(pi.reduce(lines.map((l) => JSON.stringify(l)).join('\n')).docsReadCalls).toBe(2);
  });
  it('opencode: tool_use part state input', () => {
    const lines = [
      { type: 'tool_use', part: { type: 'tool', tool: 'bash', state: { status: 'completed', input: { command: `curl -s ${B}/docs/llm` } } } },
      { type: 'tool_use', part: { type: 'tool', tool: 'bash', state: { status: 'completed', input: { command: 'ls' } } } },
      { type: 'step_finish', part: { tokens: { input: 1, output: 1 } } },
    ];
    expect(opencode.reduce(lines.map((l) => JSON.stringify(l)).join('\n')).docsReadCalls).toBe(1);
  });
  it('codex: command_execution items', () => {
    const lines = [
      { type: 'item.completed', item: { type: 'command_execution', command: `curl -s ${B}/llms.txt > llms.txt` } },
      { type: 'item.completed', item: { type: 'command_execution', command: "sed -n '1,120p' llms.txt" } },
      { type: 'item.completed', item: { type: 'command_execution', command: 'pwd' } },
      { type: 'turn.completed', usage: {} },
    ];
    expect(codex.reduce(lines.map((l) => JSON.stringify(l)).join('\n')).docsReadCalls).toBe(2);
  });
});
