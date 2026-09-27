/**
 * What an on-demand feature (lib/dynamic `onDemand`) says when its code could
 * not be downloaded: the reason, and the gesture that tries again. Never a
 * silent no-op — a control that does nothing when pressed reads as broken.
 */
export function LoadFailure({ what, onRetry, className = '' }: { what: string; onRetry: () => void; className?: string }) {
  return (
    <p role="alert" className={`font-mono text-xs text-danger ${className}`}>
      Could not load {what}.{' '}
      <button type="button" aria-label={`Retry loading ${what}`} onClick={onRetry} className="cursor-pointer underline underline-offset-2 hover:text-fg">
        Retry
      </button>
    </p>
  );
}
