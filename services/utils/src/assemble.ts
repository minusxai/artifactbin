import { Hono, type Env } from 'hono';
import type { Part } from '@artifactbin/contracts';

/**
 * ORDERED LIST IN, HONO APP OUT. Overrides are by name: a Part replaces the
 * one of that name IN ITS POSITION, `null` removes it. `assemble` never
 * reorders — the default list in each service is the readable truth about
 * middleware order — and it refuses two parts with one name, because a
 * silently shadowed route is exactly the drift this mechanism exists to end.
 */
export function assemble<E extends Env = any>(parts: Part<E>[], overrides: Record<string, Part<E> | null> = {}): Hono<E> {
  const names = new Set<string>();
  for (const p of parts) {
    if (names.has(p.name)) throw new Error(`assemble: duplicate part "${p.name}"`);
    names.add(p.name);
  }
  for (const name of Object.keys(overrides)) {
    if (!names.has(name)) throw new Error(`assemble: no part named "${name}" to override (have: ${[...names].join(', ')})`);
  }
  const app = new Hono<E>();
  for (const p of parts) {
    const o = overrides[p.name];
    if (o === null) continue;
    (o ?? p).mount(app);
  }
  return app;
}
