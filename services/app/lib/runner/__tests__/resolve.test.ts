import { beforeEach, describe, expect, it, vi } from 'vitest';

const rows = new Map<string, { source: string }>();
vi.mock('../../artifacts', () => ({
  getArtifactById: async (id: string) => {
    const row = rows.get(id);
    return row && { id, format: 'markup', deleted_at: null, version: 1, edit_id: 'e1', source: row.source };
  },
  canReadArtifact: async () => true,
  declarationsForRow: async () => null,
}));

import { resolveLambdaProgram } from '../resolve';

const BARE = '<Helmet><script>{`export default () => "browser-marker"`}</script></Helmet><p>x</p>';
const SERVER = '<Helmet><script type="server">{`export default () => "server-marker"`}</script></Helmet><p>x</p>';
const BOTH = '<Helmet><script>{`export default () => "browser-marker"`}</script><script type="server">{`export default () => "server-marker"`}</script></Helmet><p>x</p>';

describe('resolveLambdaProgram', () => {
  beforeEach(() => rows.clear());

  it('resolves the typed server script', async () => {
    rows.set('a', { source: SERVER });
    const resolved = await resolveLambdaProgram('a', 'u');
    expect(resolved?.program.language).toBe('javascript');
    expect(resolved?.program.source).toContain('server-marker');
  });

  it('ignores the browser script beside a typed server script', async () => {
    rows.set('a', { source: BOTH });
    const resolved = await resolveLambdaProgram('a', 'u');
    expect(resolved?.program.source).toContain('server-marker');
    expect(resolved?.program.source).not.toContain('browser-marker');
  });

  it('is null when the Helmet has only a browser script: that is the author script, never a server handler', async () => {
    rows.set('a', { source: BARE });
    expect(await resolveLambdaProgram('a', 'u')).toBeNull();
  });
});
