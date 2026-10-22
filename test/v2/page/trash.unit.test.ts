import test from 'node:test';
import assert from 'node:assert/strict';
import { restorePaths } from '../../../src/trash/model.ts';
test('restore preserves paths while a parent exists and falls back to root otherwise', () => {
 const item = { id: 'Ab1234', path: 'folder/page', kind: 'page' as const };
 assert.equal(restorePaths([item], item, ['folder'])[0]?.path, 'folder/page');
 assert.equal(restorePaths([item], item, [])[0]?.path, 'page');
});
test('restore refuses collision instead of overwriting a newer live file', () => {
 const item = { id: 'Ab1234', path: 'folder/page', kind: 'page' as const };
 assert.throws(() => restorePaths([item], item, ['page']), /restore path/);
});
