import {createHash} from 'node:crypto';
/** Replaces only the audited frozen form; native dialog/portal/focus semantics stay owned by the kit. */
export function archivedDialogMutationFormSource(source:string,helperPath:string):string {
 const start=source.indexOf('function MutationForm('),end=source.indexOf('export function DialogContent',start);
 if(start<0||end<start||createHash('sha256').update(source.slice(start,end)).digest('hex')!=='9a1bdade37cdae5295a436d5bc5b38967819a193790630f8fb6fb1275a58659c')throw Error('Unsupported archived dialog mutation form');
 const replacement=`function MutationForm(props: { name: string; args: unknown; stacked: boolean; children: JSX.Element }) {
  const ctx = state(); const island = useIsland(); const store = island.store() as any;
  let form: HTMLFormElement | undefined;
  const read = () => props.args && typeof props.args === 'object' && store
    ? resolveBindings(props.args as Record<string, BindingSource>, ref => ref === '_me.id' ? (() => { const v = island.viewer(); return v && 'id' in v ? v.id : null; })() : store.getValue(ref)) : undefined;
  const controller = createCompiledDialogForm({
    unavailable: () => !store || typeof store.dialogMutationUnavailable !== 'function' ? ACCESS_PENDING : store.dialogMutationUnavailable(props.name),
    authorizationContext: () => store?.authorizationContext?.() ?? null,
    unknown: () => store?.mutationState?.(props.name) === 'unknown',
    validate: () => form?.reportValidity() === true,
    args: read,
    mutate: args => store.mutate(props.name, args),
    reconcile: () => store.reconcileMutation(props.name),
    busy: value => ctx.setBusy(value), close: () => ctx.setOpen(false)
  });
  let mounted=false;
  const [status, setStatus] = createSignal({busy:false,error:null as string|null,unavailable:ACCESS_PENDING as string|null,unknown:false,canReconcile:false});
  const stop = controller.subscribe(() => { if(mounted)setStatus(controller.state()); });
  onMount(() => { mounted=true;controller.refresh(); });
  createEffect(() => { island.mutationUnavailable(props.name); island.mutating(props.name); controller.refresh(); });
  onCleanup(() => { stop(); controller.dispose(); });
  return <form ref={form} class={props.stacked ? 'contents' : undefined} on:submit={event => { event.preventDefault(); void controller.submit(); }}>
    <fieldset disabled={ctx.busy() || status().unavailable !== null || status().unknown} class="contents">{props.children}</fieldset>
    <Show when={status().unavailable}><p role="status">{refusalText(status().unavailable)}</p></Show>
    <Show when={status().error || status().unknown}>{status().unknown ? <button type="button" disabled={!status().canReconcile} on:click={() => { void controller.reconcile(); }}>Reconcile save</button> : <p role="alert" class="text-destructive">{status().error}</p>}</Show>
  </form>;
}
`;
 return `import {createCompiledDialogForm} from ${JSON.stringify(helperPath)};\n`+source.slice(0,start)+replacement+source.slice(end);
}
