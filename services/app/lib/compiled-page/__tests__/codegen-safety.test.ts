/**
 * The codegen-safety harness judges structure, not strings: it must call two
 * modules that differ only in literals the same, and two that differ in code
 * different — otherwise the compiler's safety test could pass by accident.
 */
import { describe, expect, it } from 'vitest';
import { BENIGN_STRINGS, HOSTILE_STRINGS, hostileDocument, shapeOf, structureIndependent } from '../codegen-safety';

const module = (label: string, extra = '') => `import * as rt from '@mx/rt';\nexport default function S() { return <div class=${JSON.stringify(label)}>{${JSON.stringify(label)}}${extra}</div>; }\n`;

describe('shapeOf', () => {
  it('is the same for modules that differ only in their literals', () => {
    expect(shapeOf(module('one'))).toBe(shapeOf(module('</script><script>alert(1)</script>')));
    expect(shapeOf('const a = `x${1}y`;')).toBe(shapeOf('const a = `hostile${1}text`;'));
  });
  it('differs when the code differs', () => {
    expect(shapeOf(module('one'))).not.toBe(shapeOf(module('one', '<span/>')));
    expect(shapeOf('alert(1)')).not.toBe(shapeOf('alert("1")'));
  });
});

describe('hostileDocument', () => {
  it('places every string in a position the compiler emits, and the same tree for benign and hostile strings', () => {
    const shape = (doc: ReturnType<typeof hostileDocument>) => JSON.stringify(doc.nodes, (key, value: unknown) => (key === 'value' || key === 'json' ? undefined : value));
    expect(shape(hostileDocument(BENIGN_STRINGS))).toBe(shape(hostileDocument(HOSTILE_STRINGS)));
    const text = JSON.stringify(hostileDocument(HOSTILE_STRINGS));
    for (const hostile of HOSTILE_STRINGS) expect(text).toContain(JSON.stringify(hostile).slice(1, -1));
  });
});

describe('structureIndependent', () => {
  it('passes a compiler that only ever emits literals', async () => {
    const verdict = await structureIndependent((doc) => {
      const strings = JSON.stringify(doc.nodes).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replaceAll(String.fromCharCode(0x2028), '\\u2028').replaceAll(String.fromCharCode(0x2029), '\\u2029');
      return { skeleton: `export const s = ${strings};`, islands: `export const i = [${strings}];` };
    });
    expect(verdict).toEqual({ skeletonIndependent: true, islandsIndependent: true, leaked: [] });
  });
  it('fails a compiler that lets author text shape the code or leak raw', async () => {
    const verdict = await structureIndependent((doc) => {
      const first = (doc.nodes[1] as { children: Array<{ value?: string }> }).children[0]?.value ?? '';
      // The text becomes CODE (a comment is enough to change the AST when it holds `*/`), and rides raw.
      return { skeleton: `export const s = "${first}"; ${first.includes('alert') ? 'alert(1);' : ''}`, islands: `export const i = 1; /* ${first} */` };
    });
    expect(verdict.skeletonIndependent).toBe(false);
    expect(verdict.leaked).toContain('</script');
  });
});
