/* @jsxImportSource solid-js */
/**
 * P3 PROBE, JSDOM (not a browser): typing cost per keystroke, React FlowEditor vs Solid FlowEditor
 * over the same framework-free view (lib/editor-v2/flow-view), same document, same keystrokes.
 *
 * One keystroke = what ProseMirror does once it has read an input: `view.dispatch(insertText)`,
 * through flow-view's guarded pipeline → `onChange(sourceNodes)` → the harness stores the nodes as
 * its state (React useState / Solid signal) → the adapter re-renders/re-runs → `sync` compares the
 * echo (serializeJsx both sides) and keeps the DOM. Timed synchronously around that whole loop
 * (React inside `act`, so its render and layout effects are included). Not included: DOM input
 * parsing (jsdom has no layout), paint, the page's live-edits buffer.
 *
 * Per engine and rep: 50 warm-up keystrokes discarded, then 200 timed; three reps alternating which
 * engine goes first. Writes a table to $P3_BENCH_OUT (else the console); asserts only that both
 * engines produced the same authored source.
 */
import { writeFileSync } from 'node:fs';
import { afterAll, expect, it } from 'vitest';
import { createSignal } from 'solid-js';
import { render as solidRender } from 'solid-js/web';
import { act, createElement, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { EditorView } from 'prosemirror-view';
import { TextSelection } from 'prosemirror-state';
import { parseJsx, serializeJsx, type JsxNode } from '@/lib/jsx';
import { FlowEditor as ReactFlowEditor } from '@/lib/editor-v2/flow-editor';
import { FlowEditor as SolidFlowEditor } from '../FlowEditor';

const WARMUP = 50, KEYS = 200, REPS = 3;
const DOC = Array.from({ length: 24 }, (_, i) =>
  `<p id="p${i}">Paragraph ${i} carries a sentence with <strong>bold</strong> and <em>emphasis</em> so serialization has real work.</p>`).join('');
const nodes = () => { const p = parseJsx(DOC); if (!p.ok) throw Error(p.error); return p.nodes; };

interface Mounted { view: () => EditorView; changes: () => number; source: () => string; dispose(): void; key(text: string): void }

function mountReact(): Mounted {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.body.appendChild(document.createElement('div'));
  const root = createRoot(host);
  let engine: EditorView | null = null, changes = 0, latest: JsxNode[] = nodes();
  function Harness() {
    const [current, setCurrent] = useState<JsxNode[]>(latest);
    return createElement(ReactFlowEditor, { nodes: current, path: '0', onView: (v: EditorView | null) => { if (v) engine = v; },
      onChange: (next: JsxNode[]) => { changes++; latest = next; setCurrent(next); } });
  }
  act(() => root.render(createElement(Harness)));
  return {
    view: () => engine!, changes: () => changes, source: () => serializeJsx(latest),
    key(text) { act(() => { const v = engine!; v.dispatch(v.state.tr.insertText(text)); }); },
    dispose() { act(() => root.unmount()); host.remove(); },
  };
}

function mountSolid(): Mounted {
  const host = document.body.appendChild(document.createElement('div'));
  let engine: EditorView | null = null, changes = 0;
  const [current, setCurrent] = createSignal<JsxNode[]>(nodes());
  const dispose = solidRender(() => <SolidFlowEditor nodes={current()} path="0" onView={(v) => { if (v) engine = v; }}
    onChange={(next) => { changes++; setCurrent(next); }} />, host);
  return {
    view: () => engine!, changes: () => changes, source: () => serializeJsx(current()),
    key(text) { const v = engine!; v.dispatch(v.state.tr.insertText(text)); },
    dispose() { dispose(); host.remove(); },
  };
}

function run(mount: () => Mounted) {
  const m = mount();
  const v = m.view();
  // Caret at the end of the fourth paragraph's text.
  let end = 0, seen = 0;
  v.state.doc.descendants((n, pos) => { if (n.isTextblock && seen++ === 3) end = pos + n.nodeSize - 1; });
  v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, end)));
  const text = 'the quick brown fox jumps over the lazy dog '.repeat(10);
  for (let i = 0; i < WARMUP; i++) m.key(text[i % text.length]!);
  const times: number[] = [];
  for (let i = 0; i < KEYS; i++) {
    const t0 = performance.now();
    m.key(text[(WARMUP + i) % text.length]!);
    times.push(performance.now() - t0);
  }
  const result = { times, changes: m.changes(), source: m.source() };
  m.dispose();
  return result;
}

const q = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]!;
const rows: string[] = [];
const pooled: Record<string, number[]> = { react: [], solid: [] };
afterAll(() => {
  const lines = ['| rep | engine | keys timed | onChange calls | median ms | p95 ms | mean ms |', '| --- | --- | ---: | ---: | ---: | ---: | ---: |', ...rows];
  for (const [engine, all] of Object.entries(pooled)) {
    const s = [...all].sort((a, b) => a - b);
    lines.push(`pooled ${engine}: n=${s.length} median=${q(s, 0.5).toFixed(3)} ms p95=${q(s, 0.95).toFixed(3)} ms`);
  }
  // The suite silences console output of passing tests; P3_BENCH_OUT names a file for the table.
  if (process.env.P3_BENCH_OUT) writeFileSync(process.env.P3_BENCH_OUT, lines.join('\n') + '\n');
  else console.log(lines.join('\n'));
});

it('types 200 keystrokes into the same document through both adapters (jsdom)', () => {
  const sources: Record<string, string> = {};
  for (let rep = 1; rep <= REPS; rep++) {
    const order = rep % 2 ? (['react', 'solid'] as const) : (['solid', 'react'] as const);
    for (const engine of order) {
      const r = run(engine === 'react' ? mountReact : mountSolid);
      const s = [...r.times].sort((a, b) => a - b);
      pooled[engine]!.push(...r.times);
      rows.push(`| ${rep} | ${engine} | ${s.length} | ${r.changes} | ${q(s, 0.5).toFixed(3)} | ${q(s, 0.95).toFixed(3)} | ${(s.reduce((a, b) => a + b, 0) / s.length).toFixed(3)} |`);
      expect(r.changes).toBe(WARMUP + KEYS);
      sources[`${engine}${rep}`] = r.source.replace(/ id="e[0-9a-f]{32}"/g, '');
    }
  }
  // Inline elements get generated identities (random per mount); compare the authored text only.
  expect(new Set(Object.values(sources)).size).toBe(1);
  expect(Object.values(sources)[0]).toContain('emphasis</em> so serialization has real work.the quick brown');
});
