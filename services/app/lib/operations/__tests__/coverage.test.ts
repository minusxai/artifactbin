/**
 * No operation outside the registry: every bearer route under /api/artifacts
 * maps to a registry operation's HTTP address, and every MCP tool is a
 * registry operation — so a route or tool cannot be added in one transport
 * and forgotten in the other (or in the docs, which render the same list).
 *
 * Named exceptions only: the annotations LIST (a history/debug read whose
 * primary form is inlined on get_artifact — deliberately not a tool).
 */
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { OPERATIONS } from '@/lib/operations/registry';

const ROOT = path.resolve(__dirname, '../../..');

/** Every route.ts under app/api/artifacts, as its URL path with {param} segments. */
function routePaths(dir: string, prefix: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      const seg = entry.startsWith('[') ? `{${entry.slice(1, -1)}}` : entry;
      routePaths(full, `${prefix}/${seg}`, out);
    } else if (entry === 'route.ts') {
      out.push(prefix);
    }
  }
  return out;
}

/** Routes that are deliberately NOT operations, each with its reason beside it here. */
const EXCEPTIONS = new Set([
  '/api/artifacts/{id}/annotations', // the list view — the primary read is get_artifact, which inlines the open set
]);

describe('the registry covers the surface', () => {
  it('every /api/artifacts route is an operation (or a named exception)', () => {
    const routes = routePaths(path.join(ROOT, 'app/api/artifacts'), '/api/artifacts');
    const opPaths = new Set(OPERATIONS.map((o) => normalize(o.http.path)));
    for (const route of routes) {
      if (EXCEPTIONS.has(route)) continue;
      expect(opPaths.has(normalize(route)), `${route} has no operation`).toBe(true);
    }
  });

  it('every operation path is a real route file', () => {
    const routes = new Set([
      ...routePaths(path.join(ROOT, 'app/api/artifacts'), '/api/artifacts'),
      ...routePaths(path.join(ROOT, 'app/api/connections'), '/api/connections'),
      // export_artifact's HTTP twin lives under the document's own sub-path.
      ...routePaths(path.join(ROOT, 'app/a'), '/a'),
    ].map(normalize));
    for (const op of OPERATIONS) {
      expect(routes.has(normalize(op.http.path)), `${op.name}: ${op.http.path} has no route file`).toBe(true);
    }
  });
});

/** Param NAMES differ between the file system ([annId]) and the wire (annotation_id); the position is the contract. */
function normalize(p: string): string {
  return p.replace(/\{[^}]+\}/g, '{}');
}
