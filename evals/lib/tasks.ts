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
import type { Task } from './contracts';
import { actionTransport, DEFAULT_MODE, installsSkills, type EvalMode } from './mode';

const PASTE_TOKEN = /using this token: mx_[A-Za-z0-9_-]+/;

export type Access =
  | { kind: 'start-link'; startPrompt: string }
  | { kind: 'token'; base: string; token: string; id: string };

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
    return `The artifact-bin MCP server is already connected as "artifact-bin" and authenticated. Work on document ${access.id} through its tools. The artifact-bin skill is installed in this session — start with its SKILL.md; its dispatch table names the reference files beside it.`;
  }
  if (actions === 'mcp') {
    // Fetched, MCP-compiled skills: the query parameter selects the tool
    // vocabulary rather than the default API/curl rendering.
    return `The artifact-bin MCP server is already connected as "artifact-bin" and authenticated. Work on document ${access.id} through its tools. Read ${access.base}/docs/artifact-bin/SKILL.md?transport=mcp first; it is the MCP-tool brief, and ${access.base}/docs?transport=mcp lists its references.`;
  }
  if (installed) {
    // The vocabulary is INSTALLED. Naming the skills is not a thumb on the scale — it is
    // what a person with the plugin gets, since a harness matches a skill by its description
    // and the eval's brief never mentions artifact-bin. What would be a thumb on the scale is
    // the HTTP line below, which sends it to fetch what it is already holding.
    return `The artifact store is at ${access.base}. Your API token is ${access.token} — send it as \`Authorization: Bearer <token>\`. You are working on document ${access.id}. The artifact-bin skill is installed in this session — start with its SKILL.md; its dispatch table names the reference files for anything it does not cover.`;
  }
  return `The artifact store is at ${access.base}. Your API token is ${access.token} — send it as \`Authorization: Bearer <token>\`. You are working on document ${access.id}. Read ${access.base}/docs/artifact-bin/SKILL.md first; it is the API-action brief, and it names the rest of the docs.`;
}
