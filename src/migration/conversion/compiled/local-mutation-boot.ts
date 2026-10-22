/** Viewer-only SQL writes over the existing archived engine and Apollo local state. */
export function localMutationBootSource(names: readonly string[]): string {
  return `
 const [localMutationPending, setLocalMutationPending] = createSignal(false);
 const localMutationAdapter = createCompiledLocalMutations(${JSON.stringify(names)}, {
   read: () => ({values: values(), tables: localTables()}),
   invalidate: () => queryController?.invalidate(),
   changed: setLocalMutationPending,
   execute: async (name, args, row, snapshot) => {
     const mutation = flow.mutations.find(m => m.name === name);
     if (!mutation || !mutation.target.local) throw Error('Local mutation unavailable');
     const request = mutationRequestFor(mutation, {
       values: snapshot.values, args, row, localTables: snapshot.tables, tz: 'UTC'
     });
     const answer = await engine.write(flow, mutation, request, {
       userId: null, now: new Date().toISOString(), tz: 'UTC'
     });
     return {target: answer.target, rows: answer.table.rows, reset: mutation.reset};
   },
   commit: (snapshot, result) => {
     let committed = false;
     client.updateQuery({query}, data => {
       const next = applyCompiledLocalMutation(snapshot, checked(data.compiledPage), declarations, result);
       committed = true;
       return {...data, compiledPage: next};
     });
     if (!committed) throw Error('Local save was not committed');
   }
 });
 store.mutate = (name, args, row) => localMutationAdapter.mutate(name, args, row);
 store.dialogMutationUnavailable = () => localMutationPending() ? 'Saving local data…' : null;
 window.addEventListener('pagehide', event => {
   if (!event.persisted) localMutationAdapter.dispose();
 });`;
}
