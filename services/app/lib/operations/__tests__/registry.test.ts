/**
 * The operations registry — ONE curated list of what an agent can do, from
 * which the MCP tools, the HTTP artifact routes and the docs' endpoint
 * reference are all rendered. These are the rules that keep it a registry
 * rather than a dump of routes (the pitfall every OpenAPI→MCP generator
 * warns about): model-facing descriptions, one worked example per operation
 * that actually parses, read/write/destructive annotated, and an error
 * vocabulary with a fix per code.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { OPERATIONS } from '@/lib/operations/registry';

describe('the registry is curated, not generated', () => {
  it('teaches atomic batches and persistent ids in the model-facing descriptions',()=>{
    const edit=OPERATIONS.find(op=>op.name==='edit_artifact')!.description;
    expect(edit).toMatch(/edits.*64/);
    expect(edit).toMatch(/final.*validat/i);
    expect(edit).toMatch(/preserve.*ids/i);
    const read=OPERATIONS.find(op=>op.name==='get_artifact')!.description;
    expect(read).toContain('anchor.nodeId');
    expect(read).toMatch(/relations.*never.*source/i);
  });
  it('names are unique snake_case verbs', () => {
    const names = OPERATIONS.map((o) => o.name);
    expect(new Set(names).size).toBe(names.length);
    for (const n of names) expect(n).toMatch(/^[a-z]+(_[a-z]+)*$/);
  });

  it('carries the fifteen operations of the protocol', () => {
    expect(OPERATIONS.map((o) => o.name).sort()).toEqual([
      'annotate', 'create_artifact', 'delete_artifact', 'edit_artifact', 'export_artifact', 'fork_artifact', 'get_artifact',
      'get_version', 'list_artifacts', 'list_versions', 'mutate_dataset', 'refresh_asset', 'restore_artifact', 'revert_artifact',
      'update_artifact',
    ]);
  });

  it('every example input parses against the operation\'s own schema', () => {
    for (const op of OPERATIONS) {
      expect(() => z.object(op.input).parse(op.example.input), op.name).not.toThrow();
    }
  });

  it('every description is one model-facing paragraph — present, bounded, saying what comes back', () => {
    for (const op of OPERATIONS) {
      expect(op.description.length, op.name).toBeGreaterThan(40);
      // Context on every MCP turn: the description must stay a paragraph, not a page.
      expect(op.description.length, op.name).toBeLessThanOrEqual(1200);
      expect(op.title, op.name).toBeTruthy();
    }
  });

  it('read/write/destructive is annotated, and the reads are the reads', () => {
    const readOnly = OPERATIONS.filter((o) => o.annotations.readOnly).map((o) => o.name).sort();
    expect(readOnly).toEqual(['export_artifact', 'get_artifact', 'get_version', 'list_artifacts', 'list_versions']);
    expect(OPERATIONS.find((o) => o.name === 'delete_artifact')!.annotations.destructive).toBe(true);
  });

  it('every operation names its HTTP address, and its path params are input fields', () => {
    for (const op of OPERATIONS) {
      // /api/artifacts is the bearer surface; export is the one op whose HTTP
      // twin is the document's own sub-path (a page can't return bytes).
      expect(op.http.path, op.name).toMatch(/^\/api\/artifacts(\/|$)|^\/a\/\{id\}\/export$/);
      expect(['GET', 'POST', 'PUT', 'DELETE']).toContain(op.http.method);
      for (const [, param] of op.http.path.matchAll(/\{(\w+)\}/g)) {
        expect(Object.keys(op.input), `${op.name}: path param ${param}`).toContain(param);
      }
    }
  });

  it('the error vocabulary has a fix per code, no code twice within an operation', () => {
    for (const op of OPERATIONS) {
      const codes = op.errors.map((e) => e.code);
      expect(new Set(codes).size, op.name).toBe(codes.length);
      for (const e of op.errors) {
        expect(e.fix, `${op.name}/${e.code}`).toBeTruthy();
        expect(e.status, `${op.name}/${e.code}`).toBeGreaterThanOrEqual(400);
      }
    }
  });
});
