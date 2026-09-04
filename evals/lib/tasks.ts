/**
 * The prompt an agent receives: the task's brief, then how it reaches the
 * product. Both handoffs are ones the docs themselves teach.
 *
 * `start-link` is the product's own paste flow — the driver mints a start
 * document and passes on the exact line a human would paste, so the doc and the
 * handoff are under test alongside the model, and the TOKEN goes to the agent
 * without the driver extracting it.
 *
 * `token` is for tasks the driver must set up first — seeding a document to
 * edit, or writing an MCP config — which requires the driver to hold the token.
 * It spends the start link itself and passes the credential on.
 */
import type { McpTarget, Task } from './contracts';
import { actionTransport, DEFAULT_MODE, installsSkills, type EvalMode } from './mode';

const PASTE_TOKEN = /using this token: mx_[A-Za-z0-9_-]+/;
/** The name the harness knows the server by, in every MCP configuration this driver writes. */
const MCP_SERVER_NAME = 'artifactbin';

export type Access =
  | { kind: 'start-link'; startPrompt: string }
  | { kind: 'token'; base: string; token: string; id: string }
  /**
   * NO credential at all — the token-less leg. There is no start document to name (minting one needs a
   * credential), so the agent is told where the store is and nothing else. What it does next — ask its
   * human, or mint its own token — is the measurement.
   */
  | { kind: 'none'; base: string };

// ---------------------------------------------------------------- before the turn

/** Read the one-time token from the product's exact paste: a `token` task's driver needs it. */
export function tokenFromPaste(startPrompt: string): string {
  const token = /using this token: (mx_[A-Za-z0-9_-]+)/.exec(startPrompt)?.[1];
  if (!token) throw new Error('start paste carries no token');
  return token;
}

/**
 * Does the driver mint this task a start document at all?
 *
 * `handoff: none` is the one that does not: `/api/start` hands out an anonymous token, and a driver
 * that spent it would be handing the agent the very credential the task exists to withhold.
 */
export function needsStartDocument(task: Task): boolean {
  return task.handoff !== 'none';
}

/** The start document as the driver holds it — its id, and the exact line a human would paste. */
export interface StartDocument {
  id: string;
  prompt: string;
}

export interface AccessPlanInput {
  task: Task;
  /** The base the AGENT is given: the task's recording proxy locally, the deployment behind a MITM. */
  base: string;
  /** What `needsStartDocument` said to mint, or null for a task that hands the agent nothing. */
  start: StartDocument | null;
  /** The leg's ACCOUNT credential, or null when the product's own paste carries the token instead. */
  credential: { token: string } | null;
  /** Does this mode install the skills into the session (`lib/mode installsSkills`)? */
  installed: boolean;
  /** The action transport the harness actually runs, after any substitution (`lib/mode planTransport`). */
  transport: 'api' | 'mcp';
}

/** EVERYTHING the driver does before the agent's turn, as values rather than side effects. */
export interface AccessPlan {
  /** How the agent is told to reach the product — the last line of its prompt. */
  access: Access;
  /** The MCP server to wire the harness to, or null. */
  mcp: McpTarget | null;
  /** The token to write into the skill's own connection file (`~/.artifactbin.env`), or null. */
  connectionToken: string | null;
  /** The document to publish before the turn (`task.seed`), or null. */
  seed: { id: string; token: string; markup: string } | null;
}

/**
 * HOW THIS TASK IS SET UP, decided by the TASK and the MODE and by nothing else.
 *
 * It used to be a branch inside the driver's `runTask`, reachable by no test, and it took its
 * token-less case from a LEG-level `--credential none` flag — so a run's rubric and its credential
 * were settable independently. That is exactly how the token-less leg came back inverted: it was
 * graded with a rubric that asked what it published while being run with no way to publish. Access is
 * a property of the task now, `handoff` says which, and there is no dispatch-time knob to disagree
 * with it.
 *
 * Every combination but `handoff: none` behaves exactly as the old branch did — see
 * `__tests__/access-plan.test.ts`, whose table was proved against that branch before it moved.
 */
export function planAccess(input: AccessPlanInput): AccessPlan {
  const { task, base, start, credential, installed, transport } = input;
  const nothing: AccessPlan = { access: { kind: 'none', base }, mcp: null, connectionToken: null, seed: null };
  if (task.handoff === 'none') {
    if (start) throw new Error(`${task.id} declares handoff: none — it must not be given a start document`);
    // An MCP connection IS a token handoff: the server is configured with a bearer before the turn.
    // Refusing loudly beats measuring an authenticated run under a "no credential" heading.
    if (transport === 'mcp') {
      throw new Error(`${task.id} declares handoff: none, and an MCP transport carries its token in the harness configuration — it cannot run without a credential`);
    }
    // Nothing else: no token, no document, no `~/.artifactbin.env`, no MCP config.
    return nothing;
  }
  if (!start) throw new Error(`${task.id} needs a start document for handoff: ${task.handoff}`);
  const mcpFor = (token: string): McpTarget => ({ name: MCP_SERVER_NAME, url: `${base}/mcp`, token });
  const withToken = (token: string): AccessPlan => ({
    access: { kind: 'token', base, token, id: start.id },
    mcp: transport === 'mcp' ? mcpFor(token) : null,
    connectionToken: null,
    seed: task.seed === undefined ? null : { id: start.id, token, markup: task.seed },
  });
  if (credential) {
    const plan = withToken(credential.token);
    // The token rides the harness's MCP configuration, as it does for a person who connected the
    // server; and for API actions it rides the skill's own connection file in the agent's HOME, which
    // is why the prompt can stop naming it. An MCP leg never gets that file: a second, curl-shaped way
    // in would measure something other than the MCP treatment.
    return transport === 'mcp' || !installed ? plan : { ...plan, connectionToken: credential.token };
  }
  // The product's paste. A `token` task needs the driver to hold the credential (to seed a document,
  // or to write an MCP config), so the driver reads it out of the paste; a `start-link` task passes
  // that paste on untouched, which is the handoff the product itself teaches.
  if (task.handoff === 'token' || installed || transport === 'mcp') return withToken(tokenFromPaste(start.prompt));
  return { access: { kind: 'start-link', startPrompt: start.prompt }, mcp: null, connectionToken: null, seed: null };
}

export interface PromptOptions {
  /** False for a model that cannot read an image — see `Leg.vision`. */
  vision?: boolean;
  /**
   * How the agent reaches the product. It decides the LAST line of the prompt,
   * and getting that wrong is not a detail: installed_skill+api_action installed the skills
   * and then told the agent to go read the docs, which it dutifully did —
   * five fetches of a page it already had — and the mode measured 3.4× the
   * cost of the paste flow it was meant to beat.
   */
  mode?: EvalMode;
}

/**
 * A text-only model still meets an image: the docs teach `GET
 * /a/<id>/export`, and an agent fetches that PNG to check its own work — then
 * its harness attaches it and the request 400s. Saying so up front costs one
 * line and saves the run.
 */
const NO_VISION = 'Note: you cannot view images, so do not fetch or open the rendered PNG — check your work by reading the document markup instead.';

export function buildPrompt(task: Task, access: Access, opts: PromptOptions = {}): string {
  const parts = [task.brief];
  if (opts.vision === false) parts.push(NO_VISION);
  parts.push(accessLine(task, access, opts.mode ?? DEFAULT_MODE));
  return parts.join('\n\n');
}

function accessLine(_task: Task, access: Access, mode: EvalMode): string {
  const actions = actionTransport(mode);
  const installed = installsSkills(mode);
  if (access.kind === 'none') {
    // An MCP connection IS a token handoff — the server is configured with a bearer before the turn — so
    // the token-less leg cannot be run over it, and saying so loudly beats measuring an authenticated run
    // under a "no credential" heading. Same refusal, same reason, as the start-link branch below.
    if (actions === 'mcp') {
      throw new Error(`${mode} carries its token in the MCP configuration, so it cannot run without a credential`);
    }
    // NOTHING about a connection: no token, no start document, no `~/.artifactbin.env` — the driver
    // deliberately wrote none, and a line claiming otherwise would send the agent looking for a file that
    // is not there instead of doing the thing being measured. Only where the store is, and how to read it.
    return installed
      ? `The artifact store is at ${access.base}. The artifactbin skill is installed in this session — start with its SKILL.md; its dispatch table names the reference files beside it. You have not been given a token or a document.`
      : `The artifact store is at ${access.base}. Read ${access.base}/docs/artifactbin/SKILL.md first; it is the API-action brief, and it names the rest of the docs. You have not been given a token or a document.`;
  }
  if (access.kind === 'start-link') {
    if (actions === 'mcp' || installed) {
      throw new Error(`${mode} requires a token handoff so the harness can be configured before it runs`);
    }
    if (!PASTE_TOKEN.test(access.startPrompt)) {
      throw new Error('start prompt carries no paste token (expected "using this token: mx_…")');
    }
    return access.startPrompt;
  }
  if (installed && actions === 'mcp') {
    // The full plugin treatment: MCP-compiled skills installed and the server
    // connected. The token rides the MCP configuration, never the prompt.
    return `The artifactbin MCP server is already connected as "artifactbin" and authenticated. Work on document ${access.id} through its tools. The artifactbin skill is installed in this session — start with its SKILL.md; its dispatch table names the reference files beside it.`;
  }
  if (actions === 'mcp') {
    // Fetched, MCP-compiled skills: the query parameter selects the tool
    // vocabulary rather than the default API/curl rendering.
    return `The artifactbin MCP server is already connected as "artifactbin" and authenticated. Work on document ${access.id} through its tools. Read ${access.base}/docs/artifactbin/SKILL.md?transport=mcp first; it is the MCP-tool brief, and ${access.base}/docs?transport=mcp lists its references.`;
  }
  if (installed) {
    // The vocabulary is INSTALLED — and so is the CONNECTION. A person with the plugin logged in once
    // and their agent saved the token where the skill's own contract says it lives, so the prompt names
    // the FILE and never the secret; the driver writes it into the harness's home before the turn
    // (`lib/credential.writeArtifactbinEnv`). Naming the skill is not a thumb on the scale — it is
    // what a person with the plugin gets, since a harness matches a skill by its description
    // and the eval's brief never mentions artifactbin. What would be a thumb on the scale is
    // the HTTP line below, which sends it to fetch what it is already holding.
    return `The artifact store is at ${access.base}, and its connection is already saved on this machine in \`~/.artifactbin.env\`. You are working on document ${access.id}. The artifactbin skill is installed in this session — start with its SKILL.md; its dispatch table names the reference files for anything it does not cover.`;
  }
  return `The artifact store is at ${access.base}. Your API token is ${access.token} — send it as \`Authorization: Bearer <token>\`. You are working on document ${access.id}. Read ${access.base}/docs/artifactbin/SKILL.md first; it is the API-action brief, and it names the rest of the docs.`;
}
