/**
 * Build-only authoring sources. The skill folder (`skills/artifactbin/`) is
 * ONE co-located set: `SKILL.md` (the brief), `example.jsx` (the complete
 * commented document the brief inlines), `llms.txt` (the served one-pager for
 * an agent with nothing installed) and `references/*.md`. The CLI's teaching
 * compiler renders the brief and the references into its bundle; the server
 * reads `llms.txt` at runtime through lib/serving/agent-discovery.
 */
import {buildSkillTree,loadSkillSources,type SkillTree} from './tree';
export * from './tree';
export * from './render';
export * from './serve';
let cached:SkillTree|null=null;
export function skillTree():SkillTree{
 return cached??=buildSkillTree(loadSkillSources());
}
