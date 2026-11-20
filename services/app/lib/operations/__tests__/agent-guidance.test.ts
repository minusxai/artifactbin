/**
 * What an agent is told before it authors.
 *
 * The operation schema (lib/operations/registry) carries this guidance on the
 * field itself, which is the one instruction surface an agent has at the
 * moment it writes, whatever else it did or did not read. ChatGPT proved this on
 * production: told merely "Tailwind classes via className", it fell back to its
 * own built-in slide skill and published a deck of bare <section>/<h1>/<ul>
 * with zero className attributes, which rendered as a wall of text.
 *
 * So the non-negotiables have to live IN the schema, not behind a link. These
 * tests pin the ones whose absence produced that page.
 */
import { describe, it, expect } from 'vitest';

describe('the sheetUrl description', () => {
  it('tells the agent the SERVER fetches the sheet', async () => {
    const { SHEET_URL_FIELD_GUIDANCE } = await import('../agent-guidance');
    // ChatGPT refused an import and asked the user to connect Google Drive,
    // believing it needed access itself. The schema must rule that out.
    expect(SHEET_URL_FIELD_GUIDANCE).toMatch(/DO NOT NEED ACCESS|server-side/i);
    expect(SHEET_URL_FIELD_GUIDANCE).toMatch(/not fetch it yourself/i);
  });
});
