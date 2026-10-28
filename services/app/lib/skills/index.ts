/**
 * The skill folder (`skills/artifactbin/`): `SKILL.md` (the brief) and `references/*.md`. The server
 * serves them at /llms.txt and /llms/<topic> and packs them into the skill zip.
 */
import {buildSkillTree,loadSkillSources,type SkillTree} from './tree';
export * from './tree';
export * from './render';
export * from './serve';
let cached:SkillTree|null=null;
export function skillTree():SkillTree{
 return cached??=buildSkillTree(loadSkillSources());
}
