/** The bundled boundary ids used by the Vega geo-asset registry. */
import { immutableSet } from './immutable-set';

/** Every id `boundary:<id>` accepts. */
export const BOUNDARY_IDS: readonly string[] = ['us-states', 'us-counties', 'world', 'india-states', 'countries'];

const BOUNDARIES = immutableSet(BOUNDARY_IDS);

/** Whether `id` names a bundled boundary set. */
export function isBoundary(id: unknown): id is string {
  return typeof id === 'string' && BOUNDARIES.has(id);
}
