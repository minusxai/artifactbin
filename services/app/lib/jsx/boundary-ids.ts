/**
 * The bundled boundary sets a `<DeckGL>` layer may name (`"data":"boundary:<id>"`), as static
 * ids: the map-spec validator (./deck-spec) checks them without loading any geometry. The
 * files, projections and the topojson loader stay in lib/viz/geo-assets, which imports this
 * list downward; lib/viz/__tests__/geo-assets.test.ts pins it to that registry's keys.
 */
import { immutableSet } from './immutable-set';

/** Every id `boundary:<id>` accepts. */
export const BOUNDARY_IDS: readonly string[] = ['us-states', 'us-counties', 'world', 'india-states', 'countries'];

const BOUNDARIES = immutableSet(BOUNDARY_IDS);

/** Whether `id` names a bundled boundary set. */
export function isBoundary(id: unknown): id is string {
  return typeof id === 'string' && BOUNDARIES.has(id);
}
