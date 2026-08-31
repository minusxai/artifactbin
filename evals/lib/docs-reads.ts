/**
 * Turns spent READING documentation — the cost the HTTP ledger cannot see.
 *
 * `docs_fetches` counts requests. Measured on a Claude Code dashboard run: ONE
 * request turn (`curl …/llms.txt -o llms.txt && curl …/docs/markup -o markup.txt`)
 * and then FOURTEEN turns of `sed -n '100,420p' llms.txt` — 42% of the run,
 * each re-sending ~50k tokens of context, with the ledger reading `1`. An agent
 * fetches once and reads the file over many turns, so what the docs cost is a
 * property of the TOOL CALLS, and only the harness transcript carries those.
 *
 * Pure: adapters hand over the tool invocations their event stream carries
 * (name + input, whatever shape) and get a count back. A call counts when it
 * fetches a docs URL, reads a docs URL, or reads a LOCAL FILE that an earlier
 * call saved a docs URL into (`-o file`, `--output file`, `> file`) — or, in
 * installed_skill mode, reads a skill file under `skills/`, greps across that
 * directory, or invokes Claude Code's `Skill` tool. Writes to
 * the product (`-X POST/PUT`, `--data`) never count, even when their body
 * mentions `/docs` — publishing is the work, not the reading.
 */
export interface ToolInvocation {
  name: string;
  input: unknown;
}

/** A docs page of this product: `/docs/...` or `/llms.txt`, on any host. */
const DOCS_URL = /https?:\/\/[^\s'"]+\/(?:docs(?:\/[^\s'"]*)?|llms\.txt)\b/;
/**
 * The same docs as FILES — the plugin's `skills/<skill>/…/<file>.md`, wherever
 * a harness installed it (`plugins/artifact-bin/skills/`, `.opencode/skills/`,
 * pi's skill dir). A read of one, or a grep across the directory, is a turn
 * spent reading docs; the production baseline read 0 for every installed_skill
 * run because only URLs counted.
 *
 * The path is matched at ANY DEPTH under the skill, because a skill's detail
 * files live in `references/`: the tree is one skill (`skills/artifact-bin/`)
 * whose topics are `references/<topic>.md`, and a rule that admitted exactly
 * one segment counted the brief and nothing else. Measured on one real plugins
 * run of the seven tasks: 7 reads counted where the transcripts hold 39 (pi)
 * and 49 (OpenCode) — the metric was blind on the mode it exists to measure.
 */
const SKILL_FILE = /(?:^|[\s'"=/])(?:[^\s'"]*\/)?skills\/[A-Za-z0-9._-]+\/(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+\.md\b/;
const SKILLS_DIR_SEARCH = /\b(?:grep|rg|ag|find)\b[^\n|;&]*\bskills\/?(?:\s|$|['"])/;
/** Claude Code loads a skill's body through its own tool. */
const SKILL_TOOL = /^skill$/i;
/** Where a shell command puts the response: curl's -o/--output, or a redirect. */
const SAVE_TARGET = /(?:(?:-o|--output)\s+|>\s*)(["']?)([^\s"';|&]+)\1/g;
const IS_WRITE = /(?:-X\s*(?:POST|PUT|PATCH|DELETE)\b|--data(?:-binary|-raw)?\b|\s-d\s)/;

function text(input: unknown): string {
  if (typeof input === 'string') return input;
  if (input && typeof input === 'object') return Object.values(input as Record<string, unknown>).filter((v) => typeof v === 'string').join(' ');
  return '';
}

function basename(p: string): string {
  return p.replace(/^.*\//, '');
}

export function countDocsReads(calls: ToolInvocation[]): number {
  const saved = new Set<string>();
  let n = 0;
  for (const call of calls) {
    const t = text(call.input);
    if (!t) continue;
    if (IS_WRITE.test(t)) continue;
    const fetchesDocs = DOCS_URL.test(t) || SKILL_FILE.test(t) || SKILLS_DIR_SEARCH.test(t) || SKILL_TOOL.test(call.name);
    const readsSaved = [...saved].some((f) => new RegExp(`(?:^|[\\s/'"=])${f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:$|[\\s'";|&)])`).test(t));
    if (fetchesDocs) {
      for (const m of t.matchAll(SAVE_TARGET)) saved.add(basename(m[2]));
    }
    if (fetchesDocs || readsSaved) n += 1;
  }
  return n;
}
