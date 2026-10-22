import { assertSavedProgramRegistration } from "../programs/registration.ts";
import { createHash, randomUUID } from "node:crypto";
import type { SqlDatabase } from "../persistence/sql.ts";
import type { BackendHost } from "../backend/contracts.ts";
import type { DatasetReadService } from "../datasets/contracts.ts";
import type { DatasetMutationService } from "../datasets/mutation/contracts.ts";
import type { DatasetSqlExecutor } from "../backend/dataset-sql-contracts.ts";
import type { SavedProgramHost } from "./saved-program-host-contracts.ts";
import { createSavedQueryRepository } from "../persistence/dataset-queries.ts";
import { createSavedQueryHost } from "./registered-query-host.ts";
import { createDatasetMutationAvailabilityRepository } from "../persistence/dataset-mutations.ts";
import {
  datasetMutationScalar,
  matchesDatasetMutationScalar,
} from "../datasets/mutation/parameter-scalars.ts";
import { invokeProgramResolver } from "../programs/service.ts";
import { assertStorable } from "../apollo/storable.ts";
import { withNativeProgramLock } from "./native-program-lock.ts";
/** Executes only compiler-admitted programs pinned to the exact saved backend/page/source tuple. */
export function createSavedProgramHost(options: {
  database: SqlDatabase;
  host: BackendHost;
  reads: DatasetReadService;
  mutations?: DatasetMutationService;
  executor?: DatasetSqlExecutor;
  now?: () => number;
}): SavedProgramHost {
  const repository = createSavedQueryRepository(options.database, options.now);
  const queries = options.executor
    ? createSavedQueryHost({ ...options, executor: options.executor })
    : undefined;
  const availability = createDatasetMutationAvailabilityRepository(
    options.database,
    options.now,
  );
  return {
    async invoke(invocation, inputJson, signal) {
      const saved = structuredClone(invocation);
      const initial = await repository.resolve(saved, signal);
      const program = initial?.registration.program;
      if (!initial || !program) return null;
      const execute = async () => {
        assertSavedProgramRegistration(initial.registration);
        if (
          typeof inputJson !== "string" ||
          new TextEncoder().encode(inputJson).length > 8192
        )
          throw Error("Program JSON exceeds limit");
        const input: unknown = JSON.parse(inputJson);
        assertStorable(input);
        const hash = createHash("sha256")
          .update(program.resolver.source)
          .digest("hex");
        if (
          hash !== program.resolver.sourceSha256 ||
          program.resolver.scriptSha256 !==
            initial.registration.moduleSourceSha256 ||
          program.resolver.operation !== "Mutation.run" ||
          program.resolver.reuse !== "one-shot" ||
          program.resolver.activation !== "not-activated"
        )
          throw Error("Program registration invalid");
        const current = async (abort: AbortSignal) => {
          const fresh = await repository.resolve(saved, abort);
          if (
            !fresh ||
            fresh.registration.program?.resolver.sourceSha256 !== hash ||
            fresh.registration.moduleSourceSha256 !==
              initial.registration.moduleSourceSha256 ||
            fresh.userId !== initial.userId
          )
            throw Error("Program unavailable");
        };
        await current(signal);
        const deployment = await options.host.compile(
          program.resolver.source,
          signal,
        );
        const queryHost = queries
          ? await queries.bind(saved, signal)
          : undefined;
        const result = await invokeProgramResolver(
          options.host,
          {
            backend: deployment,
            manifest: program.manifest,
            scriptSha256: program.resolver.scriptSha256,
            ...(program.resolver.outputBytes
              ? { outputBytes: program.resolver.outputBytes }
              : {}),
          },
          {
            principal: saved.principal,
            requestId: randomUUID(),
            transport: {
              authorize: current,
              async query(name, values, abort) {
                if (!queryHost)
                  throw Error("Program query execution unavailable");
                const result = await queryHost.execute(
                  { values, only: [name] },
                  abort,
                );
                if (result.errors[name]) throw Error(result.errors[name]);
                if (!result.tables[name])
                  throw Error("Program query unavailable");
                return result.tables[name]!.rows.map((row) => {
                  if (!Object.values(row).every(datasetMutationScalar))
                    throw Error("Invalid program query result");
                  return row as import("../author/contracts.ts").Row;
                });
              },
              async mutate(name, args, row, id, values, abort) {
                if (!options.mutations)
                  throw Error("Program mutation unavailable");
                const snapshot = await availability.snapshot(
                  initial.context,
                  name,
                  abort,
                );
                if (!snapshot) throw Error("Program mutation denied");
                const operation = snapshot.operation;
                if (
                  Object.keys(args).some(
                    (key) => !Object.hasOwn(operation.paramTypes, key),
                  )
                )
                  throw Error("Invalid registered mutation arguments");
                const params: Record<string, string | number | boolean | null> =
                  {};
                for (const [key, type] of Object.entries(
                  operation.paramTypes,
                )) {
                  if (
                    key.startsWith("_me__") ||
                    key === "_now" ||
                    Object.values(operation.rowParams ?? {}).some(
                      (ref) => ref.param === key,
                    )
                  )
                    continue;
                  const value = Object.hasOwn(args, key)
                    ? args[key]
                    : values[key];
                  if (!matchesDatasetMutationScalar(type, value))
                    throw Error("Invalid registered mutation arguments");
                  params[key] = value;
                }
                if (operation.valueParam)
                  throw Error("Program edited-value mutation unsupported");
                for (const [field, ref] of Object.entries(
                  operation.rowParams ?? {},
                )) {
                  const value = row?.[field];
                  if (!matchesDatasetMutationScalar(ref.type, value))
                    throw Error("Invalid registered row mutation argument");
                  params[ref.param] = value;
                }
                await options.mutations.mutate(
                  initial.context,
                  {
                    operation: name,
                    requestId: createHash("sha256").update(id).digest("hex"),
                    params,
                  },
                  abort,
                );
              },
            },
          },
          input,
          signal,
        );
        await current(signal);
        return JSON.stringify(result);
      };
      return program.native
        ? withNativeProgramLock(options.database, saved.pageId, execute, signal)
        : execute();
    },
  };
}
