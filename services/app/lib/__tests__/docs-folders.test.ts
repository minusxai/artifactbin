import { describe, expect, it } from 'vitest';
import { renderTree, skillTree, SKILL_FILE_MAX_BYTES } from '@/lib/skills';
import teaching from '../../../cli/src/generated/teaching.json';
const data = renderTree(skillTree(), 'https://artifactbin.example').find(({file}) => file.path === 'artifactbin/references/markup-data.md')!.text;
describe('local folder guidance', () => {
  it('documents folder operations and content restrictions in the API reference', () => {
    const api = teaching.files['references/api.md'];
    for (const term of ['parent_id', 'folder', 'restore', 'owner_only', 'invalid_parent', 'not_forkable', 'not_editable']) expect(api).toContain(term);
  });
  it('uses the same canonical reference and table grammar for folder children', () => {
    expect(data).toContain('source="ref:<folderId>"');
    expect(data).toContain('public.rows');
    expect(data).toContain('<Files');
    for (const col of ['thumbnail', 'views', 'sparkline', 'level']) expect(data).toContain(col);
    expect(data).not.toContain('ref_<folderId>');
    expect(Buffer.byteLength(data)).toBeLessThanOrEqual(SKILL_FILE_MAX_BYTES);
  });
  it('assigns Files to authored documents, not a folder content scaffold', () => {
    expect(data.replace(/\s+/g, ' ')).toContain('which a document can list with');
    expect(data).not.toMatch(/its own page|scaffold/);
  });
});
