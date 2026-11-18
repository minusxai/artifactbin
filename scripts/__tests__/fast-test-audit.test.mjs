import { it, expect, onTestFinished } from 'vitest';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { auditFastTests } from '../lib/fast-test-audit.mjs';
import {tempDirSync} from '../../services/test-support/src/temp-dir.ts';

it('audits shared dependencies once and rejects capabilities from every entry and transitive source', async () => {
  const directory = tempDirSync('fast-audit-',onTestFinished);
  const write = (file, source) => writeFileSync(path.join(directory, file), source);
  const entries = ['first.ts', 'second.ts'].map(file => path.join(directory, file));
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
});
