import {MEMBER_COLUMNS} from '@artifactbin/contracts';
import type { RunInput, QueryOutcome } from "@artifactbin/contracts";
import {
  QUERY_LIMITS as limits,
  type QueryContext,
  type QueryPorts,
  type QueryOptions,
  type QuerySource,
} from "./contracts";
import { identityMatches, prepare } from "./model";
/** A request selects names and scalar values. The registry owns everything executable. */
export function createRegisteredPageQueries(
  ports: QueryPorts,
  options: QueryOptions = {},
) {
  return {
    async execute(
      caller: QueryContext,
      request: unknown,
      signal?: AbortSignal,
    ): Promise<Record<string, QueryOutcome>> {
      const context = Object.freeze(structuredClone(caller));
      const invocation = structuredClone(request);
      if (
        ![context.pageId, context.backendId, context.backendVersion].every(
          (x) => typeof x === "string" && x.length > 0 && x.length <= 512,
        ) ||
        !Number.isSafeInteger(context.pageVersion) ||
        context.pageVersion < 1 ||
        !/^[a-f0-9]{64}$/.test(context.sourceSha256) ||
        (context.subject !== null &&
          (typeof context.subject !== "string" || !context.subject))
      )
        throw Error("invalid_query_context");
      const controller = new AbortController(),
        forward = () => controller.abort(signal?.reason);
      signal?.addEventListener("abort", forward, { once: true });
      if (signal?.aborted) forward();
      const cancelDeadline = (
        options.scheduleDeadline ??
        ((ms, expire) => {
          const timer = setTimeout(expire, ms);
          return () => clearTimeout(timer);
        })
      )(limits.wallMs, () => controller.abort(Error("query_deadline")));
      const active = controller.signal;
      // Authority/registry adapters must honor abort and drain their own I/O before settling.
      const wait = async <T>(operation: () => Promise<T>) => {
        active.throwIfAborted();
        const value = await operation();
        active.throwIfAborted();
        return value;
      };
      try {
        const plan = structuredClone(
          await wait(() => ports.registry(context, active)),
        );
        if (!plan) throw Error("denied");
        if (!identityMatches(plan.registration, context))
          throw Error("query_registration_changed");
        const identity = Object.freeze({ ...plan.registration });
        if (!(await wait(() => ports.authorize(context, identity, active))))
          throw Error("denied");
        const prepared = prepare(plan, invocation);
        const platform = await wait(() => ports.platform(context, active));
        if (
          (platform.userId !== null &&
            (typeof platform.userId !== "string" || !platform.userId)) ||
          !Number.isFinite(Date.parse(platform.now))
        )
          throw Error("invalid_query_platform");
        try {
          new Intl.DateTimeFormat("en-US", { timeZone: platform.tz });
        } catch {
          throw Error("invalid_query_platform");
        }
        Object.assign(prepared.params, {
          _me__id: platform.userId,
          _now: platform.now,
          _tz: platform.tz,
        });
        Object.assign(prepared.paramTypes, {
          _me__id: "user",
          _now: "timestamp",
          _tz: "string",
        });
        const input: RunInput = {
          tables: {
            ...Object.fromEntries(prepared.localTables.map(table=>[table.name,{columns:table.columns,rows:table.rows}])),
            _me: {
              columns: [{ name: "id", type: "user" }],
              rows: [{ id: platform.userId }],
            },
          },
          imports: Object.create(null),
          queries: prepared.queries,
          params: prepared.params,
          paramTypes: prepared.paramTypes,
          limit: limits.rows,
          timeoutMs: 5000,
        };
        let rows = prepared.localTables.reduce((count,table)=>count+table.rows.length,0),
          cells = prepared.localTables.reduce((count,table)=>count+table.rows.length*table.columns.length,0);
        const sources: Pick<QuerySource,"verify">[] = [];
        if(plan.builtins?.includes('members')){
          if(!ports.members)throw Error('query_members_unavailable');
          const members=await wait(()=>ports.members!(context,active));
          const snapshot=structuredClone(members.rows);
          if(!Array.isArray(snapshot)||snapshot.some(row=>!row||Object.keys(row).length!==2||typeof row.user_id!=='string'||!row.user_id||(row.joined_at!==null&&(typeof row.joined_at!=='string'||!Number.isFinite(Date.parse(row.joined_at))))))throw Error('invalid_query_members');
          rows+=snapshot.length;cells+=snapshot.length*MEMBER_COLUMNS.length;
          if(rows>limits.rows||cells>limits.cells)throw Error('query_input_limit');
          input.tables!._members={columns:structuredClone(MEMBER_COLUMNS),rows:snapshot};
          sources.push(members);await wait(()=>members.verify(active));
        }
        const catalogAnswers:Record<string,QueryOutcome>={};
        const catalogs=new Map<string,Awaited<ReturnType<NonNullable<QueryPorts['catalog']>>>>();
        for(const query of prepared.queries){
          if(!query.source)continue;
          if(!ports.catalog)throw Error('query_source_unsupported');
          let source=catalogs.get(query.source);
          if(!source){source=await wait(()=>ports.catalog!(context,query.source!,active));catalogs.set(query.source,source);sources.push(source);}
          await wait(()=>source.verify(active));
          const outcome=await wait(()=>source.execute(query.sql,prepared.params,prepared.paramTypes,active));
          if('error' in outcome||outcome.truncated||outcome.rows.length>limits.rows||outcome.rows.length*outcome.columns.length>limits.cells)throw Error('invalid_query_output');
          catalogAnswers[query.name]=structuredClone(outcome);
          if(Buffer.byteLength(JSON.stringify(catalogAnswers))>limits.outputBytes)throw Error('invalid_query_output');
          input.tables![query.name]=structuredClone(outcome);
          await wait(()=>source.verify(active));
        }
        input.queries=prepared.queries.filter(query=>!query.source).map(query=>({name:query.name,sql:query.sql}));
        for (const binding of input.queries.length?plan.imports:[]) {
          const source = await wait(() =>
            ports.source(context, Object.freeze({ ...binding }), active),
          );
          sources.push(source);
          let offset = 0,
            pin: string | undefined,
            columns: string | undefined;
          const table: NonNullable<RunInput["imports"]>[string][string] = {
            columns: [],
            rows: [],
          };
          do {
            const window = await wait(() => source.read(offset, 500, active));
            const signature = JSON.stringify([
              window.revision,
              window.authority,
            ]);
            if (
              pin !== undefined &&
              (pin !== signature || columns !== JSON.stringify(window.columns))
            )
              throw Error("dataset_changed");
            pin = signature;
            columns = JSON.stringify(window.columns);
            if (
              !window.revision ||
              !window.authority ||
              !Array.isArray(window.rows) ||
              window.rows.length > 500 ||
              (window.nextOffset !== null &&
                (window.rows.length === 0 ||
                  window.nextOffset !== offset + window.rows.length))
            )
              throw Error("invalid_query_input");
            table.columns = structuredClone(window.columns);
            table.rows.push(...structuredClone(window.rows));
            rows += window.rows.length;
            cells += window.rows.length * window.columns.length;
            if (rows > limits.rows || cells > limits.cells)
              throw Error("query_input_limit");
            offset = window.nextOffset ?? -1;
          } while (offset !== -1);
          input.imports![binding.alias] ??= Object.create(null);
          input.imports![binding.alias]![binding.table] = table;
        }
        if (Buffer.byteLength(JSON.stringify(input)) > limits.inputBytes)
          throw Error("query_input_limit");
        active.throwIfAborted();
        let answer: Record<string, QueryOutcome>={...catalogAnswers};
        if(input.queries.length){
        const execution = ports.execute(input, active);
        let draining: Promise<void> | undefined;
        const cancel = () => {
          draining ??= execution.cancelAndDrain(active.reason);
        };
        active.addEventListener("abort", cancel, { once: true });
        if (active.aborted) cancel();
        try {
          const localAnswer:Record<string,QueryOutcome> = await new Promise((resolve, reject) => {
            const rejectAbort = () =>
              reject(active.reason ?? Error("cancelled"));
            active.addEventListener("abort", rejectAbort, { once: true });
            if (active.aborted) rejectAbort();
            execution.result
              .then(resolve, reject)
              .finally(() => active.removeEventListener("abort", rejectAbort))
              .catch(() => {});
          });
          answer={...answer,...localAnswer};
        } finally {
          active.removeEventListener("abort", cancel);
          if (draining) await draining;
        }
        }
        active.throwIfAborted();
        answer = structuredClone(answer);
        if (
          !answer ||
          typeof answer !== "object" ||
          Buffer.byteLength(JSON.stringify(answer)) > limits.outputBytes
        )
          throw Error("invalid_query_output");
        for (const query of prepared.queries) {
          const outcome = answer[query.name];
          if (
            !outcome ||
            ("error" in outcome
              ? typeof outcome.error !== "string"
              : !Array.isArray(outcome.rows) ||
                !Array.isArray(outcome.columns) ||
                outcome.truncated ||
                outcome.rows.length > limits.rows ||
                outcome.rows.length * outcome.columns.length > limits.cells ||
                outcome.rows.some(
                  (row) =>
                    row === null ||
                    typeof row !== "object" ||
                    Array.isArray(row),
                ))
          )
            throw Error("invalid_query_output");
        }
        for (const source of sources) await wait(() => source.verify(active));
        if (!(await wait(() => ports.authorize(context, identity, active))))
          throw Error("denied");
        return Object.fromEntries(
          prepared.only.map((name) => [name, answer[name]!]),
        );
      } finally {
        cancelDeadline();
        signal?.removeEventListener("abort", forward);
        controller.abort();
      }
    },
  };
}
