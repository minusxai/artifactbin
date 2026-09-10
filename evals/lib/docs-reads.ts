/**
 * Turns spent reading guidance, including local CLI help and installed skills.
 * The HTTP ledger cannot see local reads or repeated paging of a saved file.
 * Retired documentation URLs remain recognizable as attempted reads in a
 * transcript; this metric does not serve them or enable a remote-skill mode.
 * Pure: adapters supply tool invocations, and publication writes do not count.
 */
export interface ToolInvocation {
  name: string;
  input: unknown;
}

/** Recognize attempted reads of retired docs and the CLI discovery page. */
const DOCS_URL = /https?:\/\/[^\s'"]+\/(?:docs(?:\/[^\s'"]*)?|llms\.txt)\b/;
/**
 * The same docs as FILES — the plugin's `skills/<skill>/…/<file>.md`, wherever
 * a harness installed it (`plugins/artifactbin/skills/`, `.opencode/skills/`,
 * pi's skill dir). A read of one, or a grep across the directory, is a turn
 * spent reading docs; the production baseline read 0 for every installed_skill
 * run because only URLs counted.
 *
 * The path is matched at ANY DEPTH under the skill, because a skill's detail
 * files live in `references/`: the tree is one skill (`skills/artifactbin/`)
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

/**
 * An invocation's input flattened to searchable text: a string as itself, an
 * object as its string values joined. Exported because every question about
 * WHAT a tool call touched — docs, or the local checkout (`lib/local-reads`) —
 * is asked of the same flattening.
 */
export function invocationText(input: unknown): string {
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
    const t = invocationText(call.input);
    if (!t) continue;
    if (IS_WRITE.test(t)) continue;
    const fetchesDocs = /\bafbin\s+(?:help\b|[^\n;&|]*(?:--help|(?:^|\s)-h)(?:\s|$))/.test(t) || DOCS_URL.test(t) || SKILL_FILE.test(t) || SKILLS_DIR_SEARCH.test(t) || SKILL_TOOL.test(call.name);
    const readsSaved = [...saved].some((f) => new RegExp(`(?:^|[\\s/'"=])${f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:$|[\\s'";|&)])`).test(t));
    if (fetchesDocs) {
      for (const m of t.matchAll(SAVE_TARGET)) saved.add(basename(m[2]));
    }
    if (fetchesDocs || readsSaved) n += 1;
  }
  return n;
}
