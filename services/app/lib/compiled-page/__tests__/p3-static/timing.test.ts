import { performance } from 'node:perf_hooks';
import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compilePage } from '../../compiler';
import { loadCompilerBuild } from '../../build.server';
import { corpus } from './corpus';
import { inputOf } from './harness';

const median = (samples: number[]): number => [...samples].sort((a, b) => a - b)[Math.floor(samples.length / 2)]!;

describe('Solid static compiler timing', () => {
  it('measures five warm compiles on the lab fixtures', async () => {
    const build = loadCompilerBuild();
    const docs = (await corpus()).filter((doc) => ['prose', 'kit', 'dashboard', 'deck', 'mermaid', 'kitchen-sink'].includes(doc.key));
    const report = [];
    for (const doc of docs) {
      const input = await inputOf(doc);
      await compilePage(input, build);
      const samples: number[] = [];
      for (let i = 0; i < 5; i++) {
        const start = performance.now();
        await compilePage(input, build);
        samples.push(performance.now() - start);
      }
      report.push({ key: doc.key, samples, median: median(samples) });
    }
    if (process.env.P3_REPORT_DIR) writeFileSync(`${process.env.P3_REPORT_DIR}/timing.json`, JSON.stringify(report, null, 2));
    expect(report).toHaveLength(6);
  }, 300_000);
  it('measures an 11.9 MB Tabs document with a large unopened panel', async () => {
    let seed = 0x4d595df4;
    const letter = () => { seed ^= seed << 13; seed ^= seed >>> 17; return 'abcdefghijklmnopqrstuvwxyz'[(seed >>> 0) % 26]; };
    const blocks = Array.from({ length: 661 }, (_, i) => `<p>${i}:${Array.from({ length: 18_000 }, letter).join('')}</p>`).join('');
    const markup = `<Tabs defaultValue="one"><TabsList><TabsTrigger value="one">One</TabsTrigger><TabsTrigger value="two">Two</TabsTrigger></TabsList><TabsContent value="one">Ready</TabsContent><TabsContent value="two">${blocks}</TabsContent></Tabs>`;
    const input = await inputOf({ key: 'large-tabs', group: 'tag', markup, template: null });
    const build = loadCompilerBuild();
    const samples: number[] = [];
    await compilePage(input, build);
    for (let i = 0; i < 3; i++) {
      const start = performance.now();
      await compilePage(input, build);
      samples.push(performance.now() - start);
    }
    if (process.env.P3_REPORT_DIR) writeFileSync(`${process.env.P3_REPORT_DIR}/timing-large.json`, JSON.stringify({ markupBytes: Buffer.byteLength(markup), samples, median: median(samples) }, null, 2));
    expect(Buffer.byteLength(markup)).toBeGreaterThan(11_900_000);
  }, 300_000);
});
