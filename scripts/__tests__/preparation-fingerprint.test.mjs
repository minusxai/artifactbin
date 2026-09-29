import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { preparationInputs, fingerprintInputs } from '../../services/app/scripts/preparation-fingerprint.mjs';

describe('prepared page source fingerprint', () => {
  it('tracks compiler sources while ignoring an unrelated server module', async () => {
    const root = path.resolve(import.meta.dirname, '../..');
    const inputs = await preparationInputs(root);
    const compiler = 'services/app/lib/compiled-page/compiler.ts';
    const unrelated = 'services/app/server/app.ts';
    expect(inputs).toContain(compiler);
    expect(inputs).not.toContain(unrelated);
    const original = fingerprintInputs(root, inputs);
    const changed = (file) => file === compiler
      ? Buffer.concat([readFileSync(path.join(root, file)), Buffer.from('changed')])
      : readFileSync(path.join(root, file));
    expect(fingerprintInputs(root, inputs, changed)).not.toBe(original);
    expect(fingerprintInputs(root, inputs, (file) => file === unrelated ? Buffer.from('changed') : readFileSync(path.join(root, file)))).toBe(original);
  });
});
