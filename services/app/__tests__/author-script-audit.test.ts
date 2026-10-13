/**
 * THE AUTHOR-SCRIPT AUDIT (scripts/audit-author-scripts.ts, lib/publish/prepared/script-audit.server): every live
 * document's current head script, built with today's builder, and the ones that no longer build reported by id,
 * visibility and version — over a connection opened read-only, so the audit can never change what it reads.
 *
 * Seeded through the real publish route on the harness's database, then audited over that same connection made
 * read-only, exactly as the script makes its own; the session is returned to read-write before the harness's next
 * reset (the harness owns the database — harness-rollout.test.ts pin 1).
 */
import { describe, expect, it } from 'vitest';
import { request, useAppHarness, mintAccountToken as mintToken } from '@/__tests__/harness';
import { POST as createArtifactRoute } from '@/app/api/artifacts/route';
import { claimToken, createUser, ensureUsername } from '@/lib/accounts';
import { getArtifactById } from '@/lib/artifacts';
import { drainPreparedPageWarmups } from '@/lib/publish/prepared/prepared-page.server';
import { createDocumentGraph } from '@/lib/document/document-graph';
import { auditAuthorScripts, formatScriptAudit, openReadOnly } from '@/lib/publish/prepared/script-audit.server';

const harness = useAppHarness();

const SCRIPTED = (script: string) => `<Helmet><Value name="n" type="number" default={0} /><script>{\`${script}\`}</script></Helmet><h1>Scripted</h1>`;
const GOOD = SCRIPTED('import { signal } from "page"; const [n, setN] = signal("$n"); setN(n() + 1);');
const REMOVED = SCRIPTED('import { reviewState } from "page"; const [open, setOpen] = reviewState("open", false); setOpen(!open());');

async function seed() {
  const user = await ensureUsername(await createUser({ email: `mxmx_test_audit_${Math.random().toString(36).slice(2, 8)}@example.com` }));
  const t = await mintToken('audit', user.id); await claimToken(user.id, t.token);
  const publish = async (markup: string, visibility: string) => {
    const made = await createArtifactRoute(request('/api/artifacts', { method: 'POST', token: t.token, json: { title: 'Audit', markup, visibility } }));
    if (made.status !== 201) throw new Error(await made.text());
    return ((await made.json()) as { id: string }).id;
  };
  const db = await harness.db();
  /** As an earlier deployment stored it: publish refuses this script today. */
  const storeBroken = async (id: string) => {
    const { version } = (await getArtifactById(id))!;
    await db.query('UPDATE artifacts SET document = $2::jsonb WHERE id = $1', [id, JSON.stringify(createDocumentGraph(REMOVED, version))]);
    return version;
  };
  const good = await publish(GOOD, 'public');
  const none = await publish('<h1>No script</h1><p>Mentions a &lt;script&gt; in prose only.</p>', 'public');
  const broken = await publish(GOOD, 'unlisted');
  const brokenVersion = await storeBroken(broken);
  const deleted = await publish(GOOD, 'public');
  await storeBroken(deleted);
  await db.query('UPDATE artifacts SET deleted_at = now() WHERE id = $1', [deleted]);
  await drainPreparedPageWarmups();
  return { good, none, broken, brokenVersion, deleted };
}

describe('the author-script audit', () => {
  it('reports exactly the live document whose head script no longer builds, read-only', async () => {
    const seeded = await seed();
    const harnessDb = await harness.db();
    try {
      const db = await openReadOnly(harnessDb);
      const report = await auditAuthorScripts(db);
      expect(report.failures).toEqual([{ id: seeded.broken, visibility: 'unlisted', version: seeded.brokenVersion, errors: [expect.stringMatching(/reviewState/)] }]);
      // Two live documents carry a script (the good one and the broken one); the prose page and the deleted one are not built.
      expect(report.scripted).toBe(2);
      expect(report.failures.map((f) => f.id)).not.toContain(seeded.deleted);

      // Human lines and machine output name the same failure and totals.
      const text = formatScriptAudit(report, { json: false });
      expect(text).toContain(`${seeded.broken}, unlisted, v${seeded.brokenVersion}, `);
      expect(text).toMatch(/1 of 2 scripted document\(s\) do not build/);
      const json = JSON.parse(formatScriptAudit(report, { json: true })) as typeof report;
      expect(json.failures[0]!.id).toBe(seeded.broken);

      // The session is read-only: a write inside it is refused by the database, and nothing changed.
      expect((await db.query<{ default_transaction_read_only: string }>('SHOW default_transaction_read_only')).rows[0]!.default_transaction_read_only).toBe('on');
      await expect(db.query('UPDATE artifacts SET title = $2 WHERE id = $1', [seeded.good, 'changed'])).rejects.toThrow(/read-only/);
      await expect(db.query('DELETE FROM prepared_pages')).rejects.toThrow(/read-only/);
    } finally {
      await harnessDb.query('SET default_transaction_read_only = off');
    }
    expect((await getArtifactById(seeded.good))!.title).toBe('Audit');
  });
});
