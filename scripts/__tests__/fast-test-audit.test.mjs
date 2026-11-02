import { it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { auditFastTests } from '../lib/fast-test-audit.mjs';

it('audits shared dependencies once and rejects capabilities from every entry and transitive source', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'fast-audit-'));
  const write = (file, source) => writeFileSync(path.join(directory, file), source);
  const entries = ['first.ts', 'second.ts'].map(file => path.join(directory, file));
  try {
    write('shared.ts', 'export const value = 1;');
    write('first.ts', 'export { value } from "./shared";');
    write('second.ts', 'export { value } from "./shared";');
    const inputs = await auditFastTests(entries);
    expect(inputs.filter(file => file.endsWith('/shared.ts'))).toHaveLength(1);
    expect(inputs).toHaveLength(3);
    write('second.ts', 'import "node:http";');
    await expect(auditFastTests(entries)).rejects.toThrow(/node:http/);
    write('second.ts', 'export { value } from "./shared";');
    write('shared.ts', 'export const value = fetch("https://example.test");');
    await expect(auditFastTests(entries)).rejects.toThrow(/ambient fetch/);
    write('shared.ts', 'export const value = import("./missing");');
    await expect(auditFastTests(entries)).rejects.toThrow();
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
