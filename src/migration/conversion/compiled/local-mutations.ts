import { validLocalValue } from "./local-state.ts";
import type { ApplyCompiledLocalMutation } from "./local-mutation-contracts.ts";
import type { CompiledLocalMutationPorts } from "./local-mutation-contracts.ts";
/** Serial viewer-only writes; the port contains no network or backend authority. */
export function createCompiledLocalMutations(
  names: readonly string[],
  ports: CompiledLocalMutationPorts,
) {
  let tail = Promise.resolve(),
    disposed = false,
    count = 0;
  return {
    pending: () => count > 0,
    dispose() {
      disposed = true;
      ports.invalidate();
    },
    mutate(name: string, args?: unknown, row?: unknown) {
      if (disposed || !names.includes(name))
        return Promise.reject(Error("Local mutation unavailable"));
      const copied = structuredClone({ args, row });
      count++;
      ports.changed(true);
      const answer = tail.then(async () => {
        if (disposed) throw Error("Local mutation cancelled");
        ports.invalidate();
        const snapshot = structuredClone(ports.read());
        const result = await ports.execute(
          name,
          copied.args,
          copied.row,
          snapshot,
        );
        if (disposed) throw Error("Local mutation cancelled");
        ports.invalidate();
        ports.commit(snapshot, result);
        return true;
      });
      tail = answer.then(
        () => {},
        () => {},
      );
      return answer.finally(() => {
        count--;
        ports.changed(count > 0);
      });
    },
  };
}

/** Atomic viewer state transition: table races reject, scalar edits survive resets. */
export const applyCompiledLocalMutation: ApplyCompiledLocalMutation = (
  snapshot,
  current,
  declarations,
  result,
) => {
  if(result.scalarValues){
    if(result.target!==""||result.rows!==null||result.reset?.length||Object.keys(result.scalarValues).length!==1)throw Error("Mixed local mutation result");
    for(const [name,value] of Object.entries(result.scalarValues)){
      const d=declarations.find(d=>d.name===name&&d.type!=="table");
      if(!d||!validLocalValue(d,value))throw Error("Invalid scalar mutation result");
    }
    if(Object.entries({...snapshot.values,...snapshot.tables}).some(([name,value])=>JSON.stringify(current[name])!==JSON.stringify(value)))throw Error("Local state changed before save completed");
    return {...current,...result.scalarValues};
  }
  const tables = Object.fromEntries(
    declarations
      .filter((d) => d.type === "table")
      .map((d) => [d.name, current[d.name]]),
  );
  if (JSON.stringify(tables) !== JSON.stringify(snapshot.tables))
    throw Error("Local table changed before save completed");
  const target = declarations.find(
    (d) => d.name === result.target && d.type === "table",
  );
  if (!target || !validLocalValue(target, result.rows))
    throw Error("Invalid local mutation result");
  const reset = Object.fromEntries(
    (result.reset ?? [])
      .filter(
        (name) =>
          Object.hasOwn(snapshot.values, name) &&
          JSON.stringify(current[name]) ===
            JSON.stringify(snapshot.values[name]),
      )
      .map((name) => {
        const declaration = declarations.find(
          (d) => d.name === name && d.type !== "table",
        );
        if (!declaration) throw Error("Invalid local reset");
        return [name, declaration.default];
      }),
  );
  return { ...current, ...reset, [result.target]: result.rows };
};
