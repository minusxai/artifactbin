/**
 * The reading budgets of the skill as the public serves it: the root guide and every public guide,
 * rendered for the production origin. A fast guard (scripts/ci/guard-tests.json): a reference that
 * fits in the tree can still overflow once projected, and that used to surface only on main.
 */
import {describe,it,expect} from 'vitest';
import {isPublicSkillTopic} from '../public-surface';
import {llmsText, publicGuideText} from '@/lib/agent-copy';
import {skillTree, SKILL_MAIN_MAX_BYTES, SKILL_FILE_MAX_BYTES, skillPackageFiles} from '..';

describe('public skill reading budgets',()=>{
 it('keeps public root and guide projections within the reading budget',()=>{
  const base='https://app.artifactbin.dev';
  expect(Buffer.byteLength(llmsText(base))).toBeLessThanOrEqual(SKILL_MAIN_MAX_BYTES);
  for(const file of skillTree().files.filter(file=>file.ref&&file.kind==='guide'&&isPublicSkillTopic(file.file.replace(/\.md$/,''))))expect(Buffer.byteLength(publicGuideText(file.file.replace(/\.md$/,''),base)!),file.path).toBeLessThanOrEqual(SKILL_FILE_MAX_BYTES);
 });
 it('leaves room in the packaged data guide for origin expansion',()=>{
  const files=skillPackageFiles(skillTree(),'https://app.artifactbin.dev');
  expect(Buffer.byteLength(files['references/datasets.md']!)).toBeLessThanOrEqual(7992);
  expect(Buffer.byteLength(publicGuideText('datasets','https://app.artifactbin.dev')!)).toBeLessThanOrEqual(7992);
 });
});
