/** Browser render allowances for explicitly admitted script origins. */
import type { PageRequest } from '@artifactbin/contracts/browser';

/** Admit only the render request's explicit origins; a render without admitted origins receives no extra allowance. */
export function scriptRenderAllowance(origins: readonly string[]): Pick<PageRequest, 'allowedOrigins'> {
  return origins.length ? { allowedOrigins: [...origins] } : {};
}
