import { describe, expect, it } from 'vitest';
import { renderTree, skillTree, SKILL_FILE_MAX_BYTES } from '@/lib/skills';
import teaching from '../../../cli/src/generated/teaching.json';
const data = renderTree(skillTree(), 'https://artifactbin.example').find(({file}) => file.path === 'artifactbin/references/markup-data.md')!.text;
describe('local folder guidance', () => {
  it('documents folder settings, restore and folder content restrictions in native teaching', () => {
    const versions = teaching.files['references/publishing-versions.md'];
    for (const term of ['folder YAML', 'push --restore', 'Do not push JSX to a folder']) expect(versions).toContain(term);
    expect(Object.keys(teaching.files)).not.toContain('references/api.md');
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
