/**
 * Build-only authoring sources. The skill folder (`skills/artifactbin/`) is
 * ONE co-located set: `SKILL.md` (the brief), `example.jsx` (the complete
 * commented document the brief inlines), and `references/*.md`. The CLI's teaching
 * compiler renders the brief and the references into its bundle; the server projects the same root and references onto its origin.
 */
import {buildSkillTree,loadSkillSources,type SkillTree} from './tree';
export * from './tree';
export * from './render';
export * from './serve';
let cached:SkillTree|null=null;
export function skillTree():SkillTree{
 return cached??=buildSkillTree(loadSkillSources());
}
