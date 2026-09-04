/**
 * WHAT THE DRIVER DOES BEFORE THE TURN — pinned as a table, so moving it out of `main.ts` cannot
 * change it.
 *
 * The token-less guard needs a seam: "no start document, no `~/.artifactbin.env`, no MCP config" is a
 * claim about the DRIVER, and until now that decision lived inline in `runTask`, where no test could
 * reach it. So it moves to `lib/tasks planAccess` — and a refactor is only safe if the behaviour it
 * moves was written down FIRST.
 *
 * `legacyPlan` below is the branch as `main.ts` ran it before the move, copied verbatim with its two
 * side effects (seed the document, write the connection file) recorded as values instead of performed.
 * Every row of TABLE is asserted against BOTH — the oracle and the extraction — so the table is not
 * something invented to fit the new code: it is what the old code did, and the new code has to match.
 */
import { describe, it, expect } from 'vitest';
import type { Access } from '../lib/tasks';

// STAGE 1 (oracle only): `planAccess` does not exist yet. These two are the pieces the extraction
// will own, copied here so the TABLE below can be proved against today's driver first.
function tokenFromPaste(startPrompt: string): string {
  const token = /using this token: (mx_[A-Za-z0-9_-]+)/.exec(startPrompt)?.[1];
  if (!token) throw new Error('start paste carries no token');
  return token;
}
interface AccessPlan {
  access: Access;
  mcp: McpTarget | null;
  connectionToken: string | null;
  seed: { id: string; token: string; markup: string } | null;
}
import type { McpTarget, Task } from '../lib/contracts';

const BASE = 'http://127.0.0.1:5220';
const START = { id: 'abc123', prompt: `Help me edit my artifact at ${BASE}/a/abc123 using this token: mx_paste` };
const ACCOUNT = { token: 'mx_account' };

const task = (over: Partial<Task> = {}): Task => ({
  id: 'protocol', kind: 'open', brief: 'Publish something.',
  handoff: 'start-link', order: 0, checks: ['published'], ...over,
});

/** `main.ts` as it stood at the seed commit — the oracle this extraction is measured against. */
function legacyPlan(i: {
  task: Task; base: string; start: { id: string; prompt: string } | null;
  credential: { token: string } | null; installed: boolean; transport: 'api' | 'mcp';
}): AccessPlan {
  const { task: t, base, start, credential, installed, transport } = i;
  let access: Access = start ? { kind: 'start-link', startPrompt: start.prompt } : { kind: 'none', base };
  let mcp: McpTarget | null = null;
  let connectionToken: string | null = null;
  let seed: AccessPlan['seed'] = null;
  if (!start) {
    // The token-less leg. Deliberately nothing.
  } else if (credential) {
    const token = credential.token;
    if (t.seed) seed = { id: start.id, token, markup: t.seed };
    access = { kind: 'token', base, token, id: start.id };
    if (transport === 'mcp') {
      mcp = { name: 'artifactbin', url: `${base}/mcp`, token };
    } else if (installed) {
      connectionToken = token;
    }
  } else if (t.handoff === 'token' || installed || transport === 'mcp') {
    const token = tokenFromPaste(start.prompt);
    if (t.seed) seed = { id: start.id, token, markup: t.seed };
    access = { kind: 'token', base, token, id: start.id };
    if (transport === 'mcp') mcp = { name: 'artifactbin', url: `${base}/mcp`, token };
  }
  return { access, mcp, connectionToken, seed };
}

interface Row {
  name: string;
  input: Parameters<typeof legacyPlan>[0];
  expected: AccessPlan;
}

const TABLE: Row[] = [
  {
    name: 'paste × fetched_skill+api_action — the product\'s own line, passed through untouched',
    input: { task: task(), base: BASE, start: START, credential: null, installed: false, transport: 'api' },
    expected: { access: { kind: 'start-link', startPrompt: START.prompt }, mcp: null, connectionToken: null, seed: null },
  },
  {
    name: 'paste × a `token` task — the driver reads the token out of the paste',
    input: { task: task({ handoff: 'token' }), base: BASE, start: START, credential: null, installed: false, transport: 'api' },
    expected: { access: { kind: 'token', base: BASE, token: 'mx_paste', id: 'abc123' }, mcp: null, connectionToken: null, seed: null },
  },
  {
    name: 'paste × a seeded `token` task — the document is published with the paste token',
    input: { task: task({ handoff: 'token', seed: '<h1>Before</h1>' }), base: BASE, start: START, credential: null, installed: false, transport: 'api' },
    expected: {
      access: { kind: 'token', base: BASE, token: 'mx_paste', id: 'abc123' }, mcp: null, connectionToken: null,
      seed: { id: 'abc123', token: 'mx_paste', markup: '<h1>Before</h1>' },
    },
  },
  {
    name: 'paste × mcp — the token rides the harness configuration',
    input: { task: task({ handoff: 'token' }), base: BASE, start: START, credential: null, installed: false, transport: 'mcp' },
    expected: {
      access: { kind: 'token', base: BASE, token: 'mx_paste', id: 'abc123' },
      mcp: { name: 'artifactbin', url: `${BASE}/mcp`, token: 'mx_paste' }, connectionToken: null, seed: null,
    },
  },
  {
    // The asymmetry is REAL and deliberately preserved: on the paste path the connection file is
    // never written, even with the skills installed. `credentialSourceFor` only ever chooses `paste`
    // for fetched_skill+api_action, so this combination is unreachable without an explicit
    // `--credential paste` — but a refactor must not quietly decide it either way.
    name: 'paste × installed — token handoff, and NO connection file (unchanged asymmetry)',
    input: { task: task(), base: BASE, start: START, credential: null, installed: true, transport: 'api' },
    expected: { access: { kind: 'token', base: BASE, token: 'mx_paste', id: 'abc123' }, mcp: null, connectionToken: null, seed: null },
  },
  {
    name: 'account × api — the driver\'s own token, no connection file until the skills are installed',
    input: { task: task(), base: BASE, start: START, credential: ACCOUNT, installed: false, transport: 'api' },
    expected: { access: { kind: 'token', base: BASE, token: 'mx_account', id: 'abc123' }, mcp: null, connectionToken: null, seed: null },
  },
  {
    name: 'account × installed_skill+api_action — the connection file the skill\'s contract names',
    input: { task: task(), base: BASE, start: START, credential: ACCOUNT, installed: true, transport: 'api' },
    expected: { access: { kind: 'token', base: BASE, token: 'mx_account', id: 'abc123' }, mcp: null, connectionToken: 'mx_account', seed: null },
  },
  {
    name: 'account × mcp — the MCP config, and never the connection file beside it',
    input: { task: task(), base: BASE, start: START, credential: ACCOUNT, installed: true, transport: 'mcp' },
    expected: {
      access: { kind: 'token', base: BASE, token: 'mx_account', id: 'abc123' },
      mcp: { name: 'artifactbin', url: `${BASE}/mcp`, token: 'mx_account' }, connectionToken: null, seed: null,
    },
  },
  {
    name: 'account × a seeded task — the document is published as the account',
    input: { task: task({ handoff: 'token', seed: '<h1>Before</h1>' }), base: BASE, start: START, credential: ACCOUNT, installed: false, transport: 'api' },
    expected: {
      access: { kind: 'token', base: BASE, token: 'mx_account', id: 'abc123' }, mcp: null, connectionToken: null,
      seed: { id: 'abc123', token: 'mx_account', markup: '<h1>Before</h1>' },
    },
  },
];

describe('the before-the-turn setup, unchanged by the move', () => {
  for (const row of TABLE) {
    it(row.name, () => {
      expect(legacyPlan(row.input), 'the oracle').toEqual(row.expected);
    });
  }

});

