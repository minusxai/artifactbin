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
import { needsStartDocument, planAccess, tokenFromPaste, type Access, type AccessPlan } from '../lib/tasks';
import type { McpTarget, Task } from '../lib/contracts';

const BASE = 'http://127.0.0.1:5220';
const START = { id: 'abc123', prompt: `Help me edit my artifact at ${BASE}/a/abc123 using this token: mx_paste` };
const ACCOUNT = { token: 'mx_account' };

const task = (over: Partial<Task> = {}): Task => ({
  id: 'protocol', kind: 'publish', brief: 'Publish something.',
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
      expect(planAccess(row.input), 'the extraction').toEqual(row.expected);
    });
  }

  it('a credentialed task is decided by the TASK and the MODE only — the leg\'s credential source is not a knob', () => {
    // Every row above names a task, a start document, a credential and a mode. Nothing else reaches
    // the decision, which is the whole point: a run's rubric and its credential were settable
    // independently, and that is how the token-less leg came back inverted.
    for (const row of TABLE) expect(planAccess(row.input)).toEqual(legacyPlan(row.input));
  });
});

/**
 * The one place the extraction deliberately does NOT match the old driver, because the old driver had
 * no such task: `handoff: none`. It hands the agent nothing, and it REFUSES an MCP transport rather
 * than running authenticated under a "no credential" heading.
 */
describe('handoff: none — the driver hands over nothing', () => {
  const none = task({ id: 'no-token', handoff: 'none', checks: ['did_not_self_mint', 'asked_for_a_token'] });

  it('names the store and nothing else: no document, no MCP config, no connection file', () => {
    expect(planAccess({ task: none, base: BASE, start: null, credential: null, installed: false, transport: 'api' }))
      .toEqual({ access: { kind: 'none', base: BASE }, mcp: null, connectionToken: null, seed: null });
  });

  it('withholds the LEG\'s credential too — the task declares the handoff, not the run', () => {
    // The leg still logs in: its other tasks need an account. This one must not get it.
    expect(planAccess({ task: none, base: BASE, start: null, credential: ACCOUNT, installed: true, transport: 'api' }))
      .toEqual({ access: { kind: 'none', base: BASE }, mcp: null, connectionToken: null, seed: null });
  });

  it('refuses an MCP transport rather than silently running the task authenticated', () => {
    expect(() => planAccess({ task: none, base: BASE, start: null, credential: null, installed: true, transport: 'mcp' }))
      .toThrow(/mcp/i);
  });

  it('refuses a start document it should never have been given', () => {
    expect(() => planAccess({ task: none, base: BASE, start: START, credential: null, installed: false, transport: 'api' }))
      .toThrow(/handoff/i);
  });

  it('every other handoff still requires one', () => {
    expect(() => planAccess({ task: task(), base: BASE, start: null, credential: null, installed: false, transport: 'api' }))
      .toThrow(/start document/i);
  });
});

/** Which tasks the driver mints a start document for at all — the other half of the same decision. */
describe('needsStartDocument', () => {
  it('is false for the token-less guard and true for every other handoff', () => {
    expect(needsStartDocument(task({ handoff: 'none' }))).toBe(false);
    expect(needsStartDocument(task({ handoff: 'start-link' }))).toBe(true);
    expect(needsStartDocument(task({ handoff: 'token' }))).toBe(true);
  });
});
