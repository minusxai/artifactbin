/**
 * The test database's schema image on disk (test/setup/database.ts, test/setup/schema-image-file.ts): named by a hash
 * of everything that decides its bytes, so an image built from another schema or engine never loads, written whole or
 * not at all when workers race, and restored by a fresh database instead of the boot DDL.
 */
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { getDb, resetDb, schemaImageInputs, schemaImageKey } from '@/lib/platform';
import { readSchemaImage, schemaImageFile, schemaImageWrites, writeSchemaImage } from '@/test/setup/schema-image-file';

// harness-exempt: reset the last test forgets the worker's database to prove a fresh one restores the on-disk schema image

const scratch = mkdtempSync(path.join(tmpdir(), 'schema-image-'));
afterAll(async () => {
  rmSync(scratch, { recursive: true, force: true });
  await resetDb();
});

describe('the image key', () => {
  const inputs = schemaImageInputs();
  const key = schemaImageKey(inputs);

  it('is stable for the same inputs and names this checkout\'s schema and engine', () => {
    expect(key).toMatch(/^[0-9a-f]{32}$/);
    expect(schemaImageKey(schemaImageInputs())).toBe(key);
    expect(inputs.statements.length).toBeGreaterThan(50);
    expect(inputs.backfills.length).toBeGreaterThan(0);
    expect(inputs.engine).toMatch(/^@electric-sql\/pglite@\d+\.\d+\.\d+/);
  });

  it('changes with any statement, backfill or engine version, so a stale image can never load', () => {
    const changed = [
      { ...inputs, statements: [...inputs.statements, 'CREATE TABLE IF NOT EXISTS extra (id TEXT)'] },
      { ...inputs, statements: inputs.statements.map((s, i) => (i === 0 ? `${s} ` : s)) },
      { ...inputs, statements: inputs.statements.slice(1) },
      { ...inputs, backfills: [...inputs.backfills, 'UPDATE users SET handle = handle'] },
      { ...inputs, engine: `${inputs.engine}-next` },
      // The same text split differently between statements is a different schema.
      { ...inputs, statements: [inputs.statements.slice(0, 2).join(''), ...inputs.statements.slice(2)] },
    ];
    const keys = changed.map(schemaImageKey);
    for (const other of keys) expect(other).not.toBe(key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('the image store', () => {
  const image = (text: string) => new Blob([text]);

  it('reads only the image stored under the asked key', async () => {
    const dir = path.join(scratch, 'read');
    await writeSchemaImage(dir, 'a'.repeat(32), image('schema a'));
    expect(await readSchemaImage(dir, 'a'.repeat(32))?.text()).toBe('schema a');
    expect(readSchemaImage(dir, 'b'.repeat(32))).toBeUndefined();
    expect(readSchemaImage(path.join(scratch, 'absent'), 'a'.repeat(32))).toBeUndefined();
  });

  it('keeps one image: a write drops the images of other keys and leaves no partial file', async () => {
    const dir = path.join(scratch, 'prune');
    await writeSchemaImage(dir, 'a'.repeat(32), image('old'));
    writeFileSync(path.join(dir, 'unrelated.txt'), 'kept');
    await writeSchemaImage(dir, 'b'.repeat(32), image('new'));
    expect(readdirSync(dir).sort()).toEqual([`${'b'.repeat(32)}.tar`, 'unrelated.txt']);
  });

  it('racing writers leave one whole image', async () => {
    const dir = path.join(scratch, 'race');
    const body = 'x'.repeat(1 << 20);
    await Promise.all(Array.from({ length: 8 }, () => writeSchemaImage(dir, 'c'.repeat(32), image(body))));
    expect(readdirSync(dir)).toEqual([`${'c'.repeat(32)}.tar`]);
    expect(statSync(schemaImageFile(dir, 'c'.repeat(32))).size).toBe(body.length);
  });
});

describe('the suite\'s own image', () => {
  it('is on disk under this checkout\'s key once a database has booted, and a fresh database restores it', async () => {
    const dir = inject('schemaImageDir');
    expect(dir).toBeDefined();
    await getDb();
    await schemaImageWrites();
    const file = schemaImageFile(dir!, schemaImageKey(schemaImageInputs()));
    expect(existsSync(file)).toBe(true);
    // Forget the worker's copy: the next database comes from the file, and builds nothing.
    globalThis.__artifact_bin_test_schema__ = undefined;
    const held = () => globalThis.__artifact_bin_test_schema__;
    const writes = globalThis.__artifact_bin_schema_image_writes__?.length ?? 0;
    await resetDb();
    const db = await getDb();
    expect(held()?.image.size).toBe(statSync(file).size);
    expect(globalThis.__artifact_bin_schema_image_writes__?.length ?? 0).toBe(writes);
    expect((await db.query("SELECT count(*)::int AS n FROM information_schema.tables WHERE table_name = 'artifacts'")).rows).toEqual([{ n: 1 }]);
  });
});
