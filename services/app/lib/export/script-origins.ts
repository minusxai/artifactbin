/** Browser render allowances for explicitly admitted script origins. */
import type { PageRequest } from '@artifactbin/contracts';

/** How long a script document's components get to replace their fallback before the shot is taken anyway. */
const MOUNT_WAIT_MS = 5_000;

/**
 * Admit only the render request's explicit origins and wait for component mounts.
 * A render without admitted origins receives no extra allowance.
 */
export function scriptRenderAllowance(origins: readonly string[]): Pick<PageRequest, 'allowedOrigins' | 'waitForMountsMs'> {
  return origins.length ? { allowedOrigins: [...origins], waitForMountsMs: MOUNT_WAIT_MS } : {};
}
