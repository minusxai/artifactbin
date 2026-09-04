/**
 * THE BRIEF TELLS AN AGENT WITH NO TOKEN WHERE TO SEND ITS HUMAN.
 *
 * Measured on the CI agent eval (run 33874008704, the `no-token` task, twice in
 * a row): the agent read the brief, correctly concluded it had no credential,
 * refused, did NOT self-mint and did NOT fabricate — and then said only "please
 * provide a bearer token". Its ledger holds exactly one request,
 * `GET /docs/artifactbin/SKILL.md`. It never called `/api`, so the 403 whose
 * body carries the ladder and the token page never arrived, and the rule that
 * names the door lived only in `publishing-auth.md`, a file it had no reason to
 * open once it already knew it lacked a token.
 *
 * A correct refusal that leaves the person exactly where they started. So the
 * DOOR moves into the brief, which is the one file every agent reads.
 *
 * The cap is the reason this is a test and not a one-line edit: the rendered
 * brief is measured at the PRODUCTION base against a hard 8,192 B, and the
 * margin before this was 18 B. It was paid for by eight wording reclaims in
 * SKILL.md, none of which dropped a rule.
 */
import { describe, expect, it } from 'vitest';
import { skillTree, SKILL_FILE_MAX_BYTES } from '@/lib/skills';
import { renderTree } from '@/lib/skills/serve';

/** The base the deployment actually serves — the only one the cap means anything at. */
const BASE = 'https://artifactbin.dev';
const brief = (transport: 'curl' | 'mcp') =>
  renderTree(skillTree(), BASE, transport).find((r) => r.file.path.endsWith('artifactbin/SKILL.md'))!.text;

describe('the brief, on having no token', () => {
  const curl = brief('curl');

  it('names the token page as a real address, not a concept', () => {
    expect(curl).toContain(`${BASE}/tokens/new`);
  });

  it('offers the other door too — the plugin/MCP needs no token at all', () => {
    expect(curl).toMatch(/plugin\/MCP/);
  });

  it('still says never to mint one', () => {
    expect(curl).toMatch(/[Nn]ever mint one/);
  });

  it('keeps the rule it already had: every call carries the bearer', () => {
    expect(curl).toContain('Authorization: Bearer <token>');
  });

  /**
   * The MCP brief must NOT grow this: that connection is already authenticated,
   * and sending an MCP client to a token page is advice for a problem it does
   * not have.
   */
  it('says nothing about token pages in the MCP rendering', () => {
    const mcp = brief('mcp');
    expect(mcp).toContain('there is no token to manage');
    expect(mcp).not.toContain('/tokens/new');
  });

  it.each(['curl', 'mcp'] as const)('the %s brief still fits the cap at the production base', (transport) => {
    const bytes = Buffer.byteLength(brief(transport), 'utf8');
    expect(bytes, `${bytes} B against a ${SKILL_FILE_MAX_BYTES} B cap`).toBeLessThanOrEqual(SKILL_FILE_MAX_BYTES);
  });
});
