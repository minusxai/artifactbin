import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SKILL_FILE_NAME, buildPreviewDatasets, buildPreviewParser, buildToolboxPlatform, skillTree } from '..';
import { AGENT_HELP_TITLE, AUTHENTICATION_INSTRUCTION, EMAIL_AUTHENTICATION_INSTRUCTION, agentDiscovery } from '../agent-discovery';

/** Bare specifiers an archive module may not carry: installs need only Node. */
const bareImports = (code: string) => [...code.matchAll(/\bfrom\s*["']([A-Za-z@][\w@/.:-]*)["']|\bimport\s*\(\s*["']([A-Za-z@][\w@/.:-]*)["']\s*\)/g)].map(m => m[1] ?? m[2]).filter(name => !name!.startsWith('node:'));

describe('SKILL_FILE_NAME', () => {
  it('names the root file of every skill in the shipped tree', () => {
    expect(SKILL_FILE_NAME).toBe('SKILL.md');
    expect(skillTree().files.some(file => file.path.endsWith(`/${SKILL_FILE_NAME}`))).toBe(true);
  });
});

describe('agentDiscovery', () => {
  it('points an agent at the guide and the skill zip, without a doubled slash', () => {
    for (const base of ['https://artifactbin.example', 'https://artifactbin.example/']) {
      const found = agentDiscovery(base);
      expect(found.url).toBe('https://artifactbin.example/llms.txt');
      expect(found.instruction).toContain('https://artifactbin.example/skills/artifactbin.zip');
      expect(found.instruction).not.toContain('example//');
      expect(found.instruction.endsWith(EMAIL_AUTHENTICATION_INSTRUCTION)).toBe(true);
    }
  });

  it('tells agents to ask for an email and never to invent one', () => {
    expect(AUTHENTICATION_INSTRUCTION.startsWith(EMAIL_AUTHENTICATION_INSTRUCTION)).toBe(true);
    expect(AUTHENTICATION_INSTRUCTION).toMatch(/Do not invent an email\.$/);
    expect(EMAIL_AUTHENTICATION_INSTRUCTION).not.toMatch(/invent/);
    expect(AGENT_HELP_TITLE).toMatch(/authentication/);
  });
});

describe('archive preview assets', () => {
  it('bundles the local dataset preview with graphql into one self-contained module, once per process', async () => {
    const first = buildPreviewDatasets();
    expect(buildPreviewDatasets()).toBe(first);
    const code = await first;
    expect(bareImports(code)).toEqual([]);
    const dir = mkdtempSync(path.join(tmpdir(), 'preview-datasets-'));
    try {
      writeFileSync(path.join(dir, 'preview-datasets.mjs'), code);
      const module = await import(pathToFileURL(path.join(dir, 'preview-datasets.mjs')).href) as { buildSchema(source: string): { getQueryType(): { name: string } | null }; parse: unknown };
      expect(module.buildSchema('type Query { a: Int }').getQueryType()?.name).toBe('Query');
      expect(typeof module.parse).toBe('function');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }, 30_000);

  it('bundles the preview parser with the shared publication helpers and answers the same bundle for the same source', async () => {
    const source = "export const marker = 'preview-parser-marker';";
    const [code, again] = await Promise.all([buildPreviewParser(source), buildPreviewParser(source)]);
    expect(again).toBe(code);
    expect(code).toContain('preview-parser-marker');
    expect(code).toMatch(/inspectPublicationBundle|authoringHtml/);
    expect(bareImports(code)).toEqual([]);
    expect(await buildPreviewParser("export const marker = 'other';")).not.toContain('preview-parser-marker');
  }, 30_000);

  it('bundles the toolbox platform with only its archive siblings external', async () => {
    const code = await buildToolboxPlatform();
    expect(bareImports(code)).toEqual([]);
    expect(code).toContain('./preview-html.mjs');
    expect(code).not.toMatch(/from\s*["']graphql["']/);
  }, 30_000);
});
