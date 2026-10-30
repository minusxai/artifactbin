import {describe,it,expect} from 'vitest';
import {skillRelease} from '../package';
import {createHash} from 'node:crypto';
describe('content addressed skill release',()=>{
 it('is deterministic, covers every member, and excludes its own metadata',()=>{
  const files={'SKILL.md':'hello','scripts/read.mjs':'code'};
  const first=skillRelease(files,'https://skills.example');
  expect(skillRelease({'scripts/read.mjs':'code','SKILL.md':'hello'},'https://skills.example')).toEqual(first);
  expect(skillRelease({...files,'scripts/read.mjs':'changed'},'https://skills.example').manifest.version).not.toBe(first.manifest.version);
  expect(skillRelease(files,'https://other.example').manifest.version).not.toBe(first.manifest.version);
  expect(first.manifest.sha256).toBe(createHash('sha256').update(first.bytes).digest('hex'));
  expect(first.manifest.url).toBe('https://skills.example/skills/artifactbin.zip');
  expect(Buffer.from(first.bytes).toString()).toContain('artifactbin/release.json');
  expect(()=>skillRelease({...files,'release.json':'untrusted'},'https://skills.example')).toThrow();
 });
});

import {GET as latest} from '@/app/skills/artifactbin/latest.json/route';
import {GET as archive} from '@/app/skills/artifactbin.zip/route';
it('publishes the checksum of the exact origin-specific downloadable archive',async()=>{
 const origin='https://release.example';
 const response=await latest(new Request(origin+'/skills/artifactbin/latest.json'));
 expect(response.status).toBe(200);
 const manifest=await response.json();
 const zip=await archive(new Request(manifest.url));
 expect(manifest).toMatchObject({schemaVersion:1,origin});
 expect(manifest.sha256).toBe(createHash('sha256').update(Buffer.from(await zip.arrayBuffer())).digest('hex'));
});
