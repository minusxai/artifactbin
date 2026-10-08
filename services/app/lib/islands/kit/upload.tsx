/* @jsxImportSource solid-js */
/** Optional upload controls load their transport and interaction code after mounting.
 * Keep this browser chunk boundary: ordinary reader readiness does not need uploads. */
import { Show, createSignal, onCleanup, onMount, type Component } from 'solid-js';
export function FileUpload(props: Record<string, unknown>) {
  const [control, setControl] = createSignal<Component<Record<string, unknown>>>();
  const [error, setError] = createSignal('');
  let disposed = false;
  onCleanup(() => { disposed = true; });
  const load = () => {
    setError('');
    void import('./upload/control').then(module => {
      if (!disposed) setControl(() => module.FileUpload);
    }).catch(() => { if (!disposed) setError('Could not load the upload control. Try again.'); });
  };
  onMount(load);
  return <Show when={control()} fallback={<div role="status" class="mx-control flex flex-col gap-3"><span>{error() || 'Preparing uploads…'}</span><Show when={error()}><button type="button" onClick={load}>Retry upload control</button></Show></div>}>{Control => <>{Control()(props)}</>}</Show>;
}
