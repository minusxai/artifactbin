export interface PageStatusProps {label: string; error?: string | null; retry?: () => void}
/** Shared themed skeleton / recoverable error, never a blank page. */
import {Button,PAGE_COLUMN,PANEL} from '@/components/ui';
export function PageStatus({label,error,retry}: PageStatusProps) {
  return <section className={`${PAGE_COLUMN} my-8`} aria-label={error ? `${label} unavailable` : `Loading ${label}`} aria-busy={!error}>
    <div className={`${PANEL} p-6 font-mono text-sm text-muted`} role={error?'alert':'status'}>
      <p>{error ?? `Loading ${label}…`}</p>
      {!error && <div aria-hidden="true" className="mt-5 space-y-3 motion-safe:animate-pulse"><div className="h-3 w-2/3 rounded bg-raised"/><div className="h-3 w-full rounded bg-raised"/><div className="h-3 w-1/2 rounded bg-raised"/></div>}
      {error && retry && <Button className="mt-4" variant="ghost" aria-label={`Retry loading ${label}`} onClick={retry}>retry</Button>}
    </div>
  </section>;
}
