/**
 * P4 (seeded RED) — the skills tree teaches folders and the trash, in BOTH transports, and
 * never the retired vocabulary. A doc is guarded like code: red first.
 */
import { describe, expect, it } from 'vitest';
import { renderTree, skillTree, SKILL_FILE_MAX_BYTES } from '@/lib/skills';

const BASE = 'https://artifactbin.example';
const rendered = (transport: 'curl' | 'mcp', path: string) =>
  renderTree(skillTree(), BASE, transport, transport === 'mcp' ? 'installed' : 'http').find(({ file }) => file.path === path)!.text;

describe('the docs teach folders', () => {
  for (const transport of ['curl', 'mcp'] as const) {
    it(`publishing.md (${transport}) names parent_id, format folder, the trash and the owner-only door`, () => {
      const doc = rendered(transport, 'artifactbin/references/publishing.md');
      for (const must of ['parent_id', "format: 'folder'", 'restore_artifact', 'owner_only', 'invalid_parent', 'not_forkable', 'folder_retired']) {
        expect(doc, must).toContain(must);
      }
      for (const never of ['folder_not_empty', '"folder":', 'folder path']) expect(doc, never).not.toContain(never);
      expect(Buffer.byteLength(doc, 'utf8')).toBeLessThanOrEqual(SKILL_FILE_MAX_BYTES);
    });
    it(`markup-data.md (${transport}) teaches the children table and <Files>`, () => {
      const doc = rendered(transport, 'artifactbin/references/markup-data.md');
      expect(doc).toContain('ref_<folderId>');
      expect(doc).toContain('<Files');
      for (const col of ['thumbnail', 'views', 'sparkline', 'level']) expect(doc, col).toContain(col);
      expect(Buffer.byteLength(doc, 'utf8')).toBeLessThanOrEqual(SKILL_FILE_MAX_BYTES);
    });
  }
  it('the brief routes folder and trash asks to publishing.md', () => {
    const brief = rendered('curl', 'artifactbin/SKILL.md');
    expect(brief.toLowerCase()).toMatch(/folder/);
    expect(brief.toLowerCase()).toMatch(/trash|restore/);
    expect(Buffer.byteLength(brief, 'utf8')).toBeLessThanOrEqual(SKILL_FILE_MAX_BYTES);
  });
});
