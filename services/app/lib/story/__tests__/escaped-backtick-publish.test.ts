/**
 * THE PUBLISH DOOR REPAIRS A SHELL-ESCAPED BACKTICK, AND SAYS SO.
 *
 * The fault, the measurement and the reasoning live in lib/jsx/repair.ts. What
 * is pinned HERE is the door's half of the contract, which the unit tests
 * cannot see: the document is accepted, the STORED source is the repaired one
 * (so the agent's next read is clean and its next edit composes against
 * something valid), and the repair is REPORTED rather than applied quietly.
 *
 * Reported is the load-bearing half. Rewriting an agent's SQL and saying
 * nothing is the failure the `</script` rule refuses outright; the same door is
 * only allowed to fix this one because the change is named on the way out.
 */
import { describe, expect, it } from 'vitest';
import { publishJsx } from '../jsx-tier';
import type { StoredContent } from '../input';

const publish = async (markup: string) => publishJsx({}, markup) as Promise<StoredContent | Response>;

const ESCAPED = '<article><Helmet><Query name="totals">{\\`select 1 as n\\`}</Query></Helmet><p>hi</p></article>';
const CLEAN = ESCAPED.replaceAll('\\`', '`');

describe('publishJsx and the shell-escaped backtick', () => {
  it('accepts the document instead of refusing it', async () => {
    const out = await publish(ESCAPED);
    expect(out instanceof Response, out instanceof Response ? await out.clone().text() : '').toBe(false);
  });

  it('stores the REPAIRED source, so the next read and edit are clean', async () => {
    const out = (await publish(ESCAPED)) as StoredContent;
    expect(out.source).not.toContain('\\`');
    expect(out.source).toContain('{`select 1 as n`}');
  });

  it('reports the repair, naming what was removed', async () => {
    const out = (await publish(ESCAPED)) as StoredContent;
    expect(out.repairs, 'a silent rewrite of an agent’s SQL is exactly what is not allowed').toBeTruthy();
    expect(out.repairs).toHaveLength(1);
    expect(out.repairs![0].code).toBe('escaped_backtick');
    expect(out.repairs![0].removed).toBe(2);
  });

  it('says nothing when there was nothing to repair', async () => {
    const out = (await publish(CLEAN)) as StoredContent;
    expect(out instanceof Response).toBe(false);
    expect(out.repairs).toBeUndefined();
  });

  it('publishes the same document either way', async () => {
    const repaired = (await publish(ESCAPED)) as StoredContent;
    const clean = (await publish(CLEAN)) as StoredContent;
    expect(repaired.source).toBe(clean.source);
  });

  it('still refuses a syntax error that is not this one', async () => {
    const out = await publish('<article><p>hi</p>');
    expect(out instanceof Response).toBe(true);
    expect((await (out as Response).json()).error).toBe('invalid_jsx');
  });
});
