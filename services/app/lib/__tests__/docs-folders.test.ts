/**
 * P4 (seeded RED) — the skills tree teaches folders and the trash, in BOTH transports, and
 * never the retired vocabulary. A doc is guarded like code: red first.
 *
 * THE FOLDER PAGE (this phase) — a folder no longer HAS a document. It used to
 * be created with a two-line scaffold as its stored `source` (a `<Query>` over
 * its own children table, drawn by `<Files>`), so the docs taught "a folder's
 * page is its own stored markup … so you edit one like any document". The row
 * now carries NO content and the page is app chrome, which makes that sentence
 * not a simplification but an instruction an agent follows into a 400: every
 * content field on a folder, and `edit_artifact` on one, is `not_editable`,
 * and a PUT takes only `title`, `visibility` and `parent_id`. `<Files>` over
 * `ref_<folderId>` survives as something an AUTHORED document may do — which
 * is exactly the distinction markup-data.md now has to keep straight, since a
 * doc that says the folder renders it sends an agent editing a row that has
 * nothing to edit.
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
    it(`publishing.md (${transport}) says a folder has NO content, and names the refusal`, () => {
      const doc = rendered(transport, 'artifactbin/references/publishing.md');
      const flat = doc.replace(/\s+/g, ' ');
      expect(flat).toContain('A FOLDER HAS NO CONTENT');
      // The PUT door, named where an agent meets it: what it takes, and what it refuses.
      expect(doc).toContain('not_editable');
      for (const must of ['`title`', '`visibility`', '`parent_id`']) expect(flat, must).toContain(must);
      // The retired mechanism, in every wording it was ever written in.
      for (const never of ['scaffold', 'Add a description', 'stored markup', 'edit one like any document']) {
        expect(flat, never).not.toContain(never);
      }
    });
    it(`markup-data.md (${transport}) teaches the children table and <Files>`, () => {
      const doc = rendered(transport, 'artifactbin/references/markup-data.md');
      expect(doc).toContain('ref_<folderId>');
      expect(doc).toContain('<Files');
      for (const col of ['thumbnail', 'views', 'sparkline', 'level']) expect(doc, col).toContain(col);
      expect(Buffer.byteLength(doc, 'utf8')).toBeLessThanOrEqual(SKILL_FILE_MAX_BYTES);
    });
    it(`markup-data.md (${transport}) gives <Files> to a DOCUMENT, never to the folder's own page`, () => {
      const flat = rendered(transport, 'artifactbin/references/markup-data.md').replace(/\s+/g, ' ');
      expect(flat).toContain('which a document can list with');
      for (const never of ['its own page lists', 'its own page', 'scaffold']) expect(flat, never).not.toContain(never);
    });
  }
  it('the brief routes folder and trash asks to publishing.md', () => {
    const brief = rendered('curl', 'artifactbin/SKILL.md');
    expect(brief.toLowerCase()).toMatch(/folder/);
    expect(brief.toLowerCase()).toMatch(/trash|restore/);
    expect(Buffer.byteLength(brief, 'utf8')).toBeLessThanOrEqual(SKILL_FILE_MAX_BYTES);
  });
});
