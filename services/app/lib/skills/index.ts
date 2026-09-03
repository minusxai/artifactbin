/**
 * The docs, as the rest of the app sees them. ONE tree, loaded from `skills/`
 * once per process (the image copies the directory beside the bundle, the
 * way it copies `orchestrator/`), and the four things consumers ask of it:
 *
 * - `renderDoc(path, base)` — one file, rendered for a caller's origin;
 * - `buildQuickSheet(base)` — the brief every agent reads
 *   (`artifactbin/SKILL.md`), at its ONE address;
 * - `buildMcpInstructions(base)` — what an MCP client is told at `initialize`
 *   (the `'mcp'` contract surface: already authenticated, no token ladder at all)
 *   (the `publishing/mcp.md` Read-first block, which is written for it);
 * - `buildDocsIndex(base)` — the `/docs` and `/llms.txt` listing.
 *
 * The names are the old builders' names on purpose: the consumers and the
 * suite kept their vocabulary, only the source moved from code to files.
 */
import { readFirstBlock, buildSkillTree, loadSkillSources, ROOT_SKILL, SKILL_FILE_NAME, SKILL_LISTING_MAX_BYTES, type SkillTree } from './tree';
import { renderSkill } from './render';
import { docsListing } from './serve';
import { agentContract } from '../agent-contract';

export * from './tree';
export * from './render';
export * from './serve';

let cached: SkillTree | null = null;

/** The tree on disk, parsed once. Tests build their own with `buildSkillTree`. */
export function skillTree(): SkillTree {
  return (cached ??= buildSkillTree(loadSkillSources()));
}

export function renderDoc(path: string, base: string): string {
  const file = skillTree().get(path);
  if (!file) throw new Error(`no skill file at skills/${path}`);
  return renderSkill(file, { base });
}

/** The always-read cap on the brief — the ratio to the reference decides whether fetching it is the cheaper move. */
export const QUICK_SHEET_MAX_BYTES = 8192;

export function buildQuickSheet(base: string): string {
  const file = skillTree().get(`${ROOT_SKILL}/${SKILL_FILE_NAME}`);
  if (!file) throw new Error(`skills/${ROOT_SKILL}/${SKILL_FILE_NAME} is missing`);
  return renderSkill(file, { base }).trimEnd() + '\n';
}

export function buildMcpInstructions(base: string): string {
  const block = readFirstBlock(renderDoc('artifactbin/references/publishing-mcp.md', base));
  if (!block) throw new Error('skills/artifactbin/references/publishing-mcp.md has no Read first block');
  return `${block.trim()}\n\n${agentContract(base, 'mcp')}\n`;
}

export const DOCS_INDEX_MAX_BYTES = SKILL_LISTING_MAX_BYTES;

export function buildDocsIndex(base: string): string {
  return docsListing(skillTree(), base);
}
