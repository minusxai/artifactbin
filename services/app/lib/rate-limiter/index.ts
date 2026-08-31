/**
 * The doors' vocabulary lives in @artifactbin/contracts and the limiter engine in
 * @artifactbin/utils; this re-export keeps the app-side helpers' imports stable. NOT re-exported
 * from the proxy — that import edge is what the lean-imports guard will forbid.
 */
export {
  DOORS, type DoorName, type DoorKey, type DoorConfig, type Identity, type Decision, type Lease,
  type LimiterBackend, type Limiter,
} from '@artifactbin/contracts';
export { doorConfig, createLimiter } from '@artifactbin/utils';
