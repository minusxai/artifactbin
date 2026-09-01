/**
 * The docs and the registry cannot drift: every error code an operation can
 * answer is documented somewhere in the rendered tree (its owner file), every
 * operation is named in the MCP reference, and every file renders clean under
 * its cap in BOTH transports — the plugin ships the `mcp` rendering, /docs
 * serves `curl`, and a file that only renders in one would ship broken in the
 * other.
 */
import { describe, expect, it } from 'vitest';
import { OPERATIONS } from '@/lib/operations/registry';
import { renderTree, skillTree, renderDoc, buildQuickSheet, serveDocs, SKILL_FILE_MAX_BYTES } from '@/lib/skills';

const BASE = 'https://example.test';

describe('docs ↔ registry parity', () => {
  const corpus = renderTree(skillTree(), BASE).map(({ text }) => text).join('\n');

  it('every operation error code is documented in the rendered tree', () => {
    for (const op of OPERATIONS) {
      for (const e of op.errors) {
        expect(corpus, `${op.name}: ${e.code} is undocumented`).toContain(e.code);
      }
    }
  });

  it('the MCP reference names every operation, from the registry', () => {
    const mcpDoc = renderDoc('artifactbin/references/publishing-mcp.md', BASE);
    for (const op of OPERATIONS) expect(mcpDoc, op.name).toContain(`\`${op.name}\``);
  });

  it('every operation HTTP address is documented in the rendered tree', () => {
    for (const op of OPERATIONS) {
      // The docs write `<id>` where the registry writes `{id}` — the address
      // is checked shape-insensitively up to the parameter spelling.
      const docPath = op.http.path.replace(/\{annotation_id\}/g, '<annotation_id>').replace(/\{(\w+)\}/g, '<$1>');
      expect(corpus, `${op.name}: ${op.http.path} is undocumented`).toContain(docPath);
    }
  });
});

describe('both transports render, under the caps', () => {
  it('the mcp rendering (the plugin) is clean and no larger than the cap', () => {
    for (const { file, text } of renderTree(skillTree(), BASE, 'mcp')) {
      expect(text, file.path).not.toMatch(/\[\[|\]\]|\[%|%\]/);
      expect(Buffer.byteLength(text), file.path).toBeLessThanOrEqual(SKILL_FILE_MAX_BYTES);
    }
  });

  it('compiles the correct skill for all four delivery/action treatments', async () => {
    const tree = skillTree();
    const brief = (transport: 'curl' | 'mcp', delivery: 'http' | 'installed') =>
      renderTree(tree, BASE, transport, delivery).find(({ file }) => file.path === 'artifactbin/SKILL.md')!.text;

    const httpApi = brief('curl', 'http');
    expect(httpApi).toContain('curl -X POST');
    expect(httpApi).toContain(`${BASE}/docs/artifactbin/references/`);

    const httpMcpResponse = serveDocs({ tree, base: BASE, path: 'artifactbin/SKILL.md', accept: '', download: false, transport: 'mcp' });
    const httpMcp = await httpMcpResponse.text();
    expect(httpMcp).toContain('create_artifact({');
    expect(httpMcp).toContain(`${BASE}/docs/artifactbin/references/<file>?transport=mcp`);

    const installedApi = brief('curl', 'installed');
    expect(installedApi).toContain('curl -X POST');
    expect(installedApi).toContain('files sit under `references/` beside this skill');
    expect(installedApi).not.toContain(`${BASE}/docs/artifactbin/references/`);

    const installedMcp = brief('mcp', 'installed');
    expect(installedMcp).toContain('create_artifact({');
    expect(installedMcp).toContain('files sit under `references/` beside this skill');
    expect(installedMcp).not.toContain(`${BASE}/docs/artifactbin/references/`);
  });

  it('the plugin brief opens with a TOOL CALL; the served brief with curl', () => {
    const tree = skillTree();
    const served = buildQuickSheet(BASE);
    expect(served).toContain('curl -X POST');
    // The served brief teaches HTTP only — tool syntax belongs to the plugin.
    expect(served).not.toMatch(/create_artifact\(|edit_artifact\(|get_artifact/);
    const plugin = renderTree(tree, BASE, 'mcp').find(({ file }) => file.path === 'artifactbin/SKILL.md')!.text;
    expect(plugin).toContain('create_artifact({');
    expect(plugin).toContain('edit_artifact({');
    expect(plugin).toContain('get_artifact');
    // …and the plugin brief carries NO hanging HTTP: no /api address, no curl,
    // no bearer handling, no bare HTTP verbs. The one URL it keeps is the
    // document's own page/export address, which is a link rather than a call.
    expect(plugin).not.toMatch(/\/api\/|curl|Bearer/);
    expect(plugin).not.toMatch(/\b(GET|POST|PUT|DELETE) /);
    // Navigation is LOCAL for the plugin: files beside the skill, not URLs.
    expect(plugin).toContain('references/');
    expect(plugin).not.toContain('download=true');
  });
});
