/**
 * M2 — an agent never mints its own token.
 *
 * The failure being removed: an agent-minted anonymous token publishes documents its human cannot reach.
 * Nothing was malfunctioning — the contract string TOLD agents to mint, and it is rendered into four
 * surfaces including the MCP `initialize` instructions, where the client is already authenticated.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { agentContract } from '@/lib/agent-contract';
import { anonymousClaimRelay } from '@/lib/agent-copy';
import { buildMcpInstructions, buildQuickSheet, renderDoc, renderTree, skillTree } from '@/lib/skills';
import { startBrief } from '@/lib/start-links';

const BASE = 'https://x.test';

describe('the contract is surface-aware', () => {
  it('tells an MCP client it is already connected, and gives it no way to get a token', () => {
    const mcp = agentContract(BASE, 'mcp');
    expect(mcp).not.toContain('tokens/anonymous');
    expect(mcp).not.toContain('/tokens/new');
    expect(mcp).toMatch(/already (authenticated|connected)/i);
  });

  it('gives an HTTP agent the saved connection and the ask-your-human rung — and never the mint', () => {
    const http = agentContract(BASE, 'http');
    expect(http).toContain('~/.artifactbin.env');
    expect(http).toContain('/tokens/new');
    expect(http).not.toContain('tokens/anonymous');
    expect(http).not.toMatch(/without a human in the loop/i);
  });
});

describe('no agent-facing surface teaches self-minting', () => {
  /**
   * THE REGRESSION GUARD FOR THE WHOLE PHASE. Not a hand-kept list of the four surfaces we happened to
   * fix — EVERY rendered doc in the tree, plus the built surfaces, so a file joins the set by existing.
   * A new reference that names the mint fails here on the day it is written.
   */
  const surfaces: [string, string][] = [
    ...renderTree(skillTree(), BASE).map(({ file, text }) => [`skills/${file.path}`, text] as [string, string]),
    ['mcp instructions', buildMcpInstructions(BASE)],
    ['the brief', buildQuickSheet(BASE)],
    ['the start brief (fill)', startBrief(BASE, 'Ab3xK9', 'secret', 'fill')],
    ['the start brief (edit)', startBrief(BASE, 'Ab3xK9', 'secret', 'edit')],
  ];
  for (const [name, text] of surfaces) {
    it(`${name} never names the anonymous mint`, () => {
      expect(text).not.toContain('tokens/anonymous');
    });
  }
  it('the MCP instructions carry no token-acquisition ladder at all', () => {
    expect(buildMcpInstructions(BASE)).not.toContain('/tokens/new');
  });
  it('publishing-auth.md still relays the claim line, so an orphaned document is recoverable', () => {
    const doc = renderDoc('artifactbin/references/publishing-auth.md', BASE);
    expect(doc).toContain(anonymousClaimRelay(BASE, '<id>'));
  });
  it('the http contract sends the human to a SOURCE-TAGGED door', () => {
    expect(agentContract(BASE, 'http')).toContain(`${BASE}/tokens/new?source=`);
  });
});

/**
 * THE GUARD THAT WOULD HAVE CAUGHT THE ONE THE DOCS GUARD MISSED.
 *
 * The rendered-tree sweep above only sees the SKILLS. It did not see the spent-start-link tombstone
 * (`app/a/[id]/start/route.ts`), which was a plain string in a route handler and which offered
 * `POST /api/tokens/anonymous` to an agent that was stuck — the single worst place to say it.
 *
 * So: no SERVER-SIDE string an agent can be handed may name that address. Comments are stripped first
 * (explaining why the address is absent is exactly what the code above does), and the browser's own
 * pages are excluded — `web/` and `components/` run IN a browser, which is the one caller allowed
 * through that door.
 */
describe('no server-side string hands an agent the mint address', () => {
  const ROOT = new URL('../../', import.meta.url);
  const ALLOWED = new Set(['server/routes.generated.ts', 'app/api/tokens/anonymous/route.ts']);
  const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

  const walk = (dir: URL, rel = ''): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      return ['node_modules', '__tests__', 'web', 'components', 'skills'].includes(entry.name)
        ? []
        : walk(new URL(`${entry.name}/`, dir), path);
    }
    return /\.tsx?$/.test(entry.name) && !/\.test\./.test(entry.name) ? [path] : [];
  });

  it('not one of them, anywhere under services/app', () => {
    const offenders = walk(ROOT).filter((path) =>
      !ALLOWED.has(path) && stripComments(readFileSync(new URL(path, ROOT), 'utf8')).includes('tokens/anonymous'));
    expect(offenders).toEqual([]);
  });
});

describe('the relay duty', () => {
  it('hands the human a claim link for a document an anonymous token published', () => {
    const line = anonymousClaimRelay(BASE, 'ab3cd9');
    expect(line).toContain(BASE);
    expect(line).toMatch(/claim/i);
    expect(line).not.toMatch(/mx_[A-Za-z0-9_-]+/);
  });
});
