/* @jsxImportSource solid-js */
/** Optional upload controls load their transport and interaction code after mounting.
 * Keep this browser chunk boundary: ordinary reader readiness does not need uploads. */
import { createSignal, untrack, onMount, type Component } from 'solid-js';
export function FileUpload(props: Record<string, unknown>) {
  // undefined: pending, null: failed, component: loaded. Solid disposes the render
  // subscriber on unmount; settling this private signal cannot mount a late control.
  const [control, setControl] = createSignal<Component<Record<string, unknown>> | null>();
  const load = () => {
    setControl(undefined);
    void import('./upload/control').then(module => {
      setControl(() => module.FileUpload);
    }).catch(() => { setControl(null); });
  };
  onMount(load);
  return <>{(() => {const Control=control();return Control ? untrack(() => Control(props)) : <div role="status" class="mx-control flex flex-col gap-3"><span>{control() === null ? 'Could not load uploads.' : 'Preparing uploads…'}</span><button type="button" hidden={control() !== null} onClick={load}>Retry upload control</button></div>;})()}</>;
}
