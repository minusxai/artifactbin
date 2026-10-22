import {
  DatasetReadError,
  DATASET_RESULT_BYTES,
  type DatasetReadRequest,
  type DatasetReadResult,
  type DatasetResolvedBinding,
  type DatasetCallContext,
  type DatasetReadService,
} from "../contracts.ts";
import type { StoredModelPorts } from "./contracts.ts";
import type { DatasetQueryJob } from "../query/contracts.ts";
import {
  validateDatasetQueryJob,
  decodeDatasetQueryAnswer,
} from "../sql/read-job.ts";
import { validateTable } from "../rows.ts";
/** Exact registered model evaluation; physical-only reads retain the original policy boundary. */
export async function readStoredModel(
  ports: StoredModelPorts,
  reads: DatasetReadService,
  context: DatasetCallContext,
  binding: DatasetResolvedBinding,
  request: DatasetReadRequest,
  authorize: (signal: AbortSignal) => Promise<void>,
  signal?: AbortSignal,
): Promise<DatasetReadResult> {
  const abort = new AbortController();
  const forward = () => abort.abort(signal?.reason);
  signal?.addEventListener("abort", forward, { once: true });
  if (signal?.aborted) forward();
  const timer = setTimeout(
    () => abort.abort(new DatasetReadError("result_limit")),
    10000,
  );
  const wait = <T>(operation: () => Promise<T>): Promise<T> =>
    new Promise((resolve, reject) => {
      const stopped = () => reject(abort.signal.reason);
      if (abort.signal.aborted) return stopped();
      abort.signal.addEventListener("abort", stopped, { once: true });
      Promise.resolve()
        .then(operation)
        .then(resolve, reject)
        .finally(() => abort.signal.removeEventListener("abort", stopped));
    });
  try {
    await wait(() => authorize(abort.signal));
    const found = await wait(() =>
      ports.resolve(context, binding, request, abort.signal),
    );
    if (!found) throw new DatasetReadError("denied");
    const model = structuredClone(found);
    if (model.datasetVersion !== binding.revision.version)
      throw new DatasetReadError("dataset_changed");
    if (
      !/^[a-f0-9]{64}$/.test(model.sourceSha256) ||
      model.schema !== request.schema ||
      model.table !== request.table ||
      !model.dependencies.length ||
      model.dependencies.length > 64
    )
      throw new DatasetReadError("invalid_dataset");
    validateTable({
      schema: model.schema,
      name: model.table,
      columns: model.columns,
      object: model.dependencies[0]!.object,
    });
    const keys = new Set<string>();
    for (const dep of model.dependencies) {
      validateTable(dep);
      const key = JSON.stringify([dep.schema, dep.name]);
      const matches = binding.tables.filter(
        (t) => t.schema === dep.schema && t.name === dep.name,
      );
      if (
        keys.has(key) ||
        matches.length !== 1 ||
        JSON.stringify(matches[0]) !== JSON.stringify(dep)
      )
        throw new DatasetReadError("invalid_dataset");
      keys.add(key);
    }
    const job: DatasetQueryJob = {
      kind: "dataset-query",
      engineVersion: "sqlite-3.53.4-read-v1",
      input: {
        tables: [],
        queries: [{ name: "result", sql: model.sql }],
        params: {},
        paramTypes: {},
      },
    };
    validateDatasetQueryJob(job);
    for (const dep of model.dependencies) {
      const table = {
        schema: dep.schema,
        table: dep.name,
        columns: [...dep.columns],
        rows: [] as Record<string, unknown>[],
      };
      job.input.tables.push(table);
      let offset = 0;
      do {
        const window = await wait(() =>
          reads.read(
            context,
            {
              binding: request.binding,
              schema: dep.schema,
              table: dep.name,
              offset,
              limit: 500,
              expectedVersion: binding.revision.version,
              expectedGeneration: binding.revision.generation,
            },
            abort.signal,
          ),
        );
        if (
          window.version !== binding.revision.version ||
          window.generation !== binding.revision.generation ||
          JSON.stringify(window.columns) !==
            JSON.stringify(
              dep.columns.map((c) => ({ name: c.name, type: c.type })),
            )
        )
          throw new DatasetReadError("dataset_changed");
        table.rows.push(...window.rows);
        validateDatasetQueryJob(job);
        offset = window.nextOffset ?? -1;
      } while (offset !== -1);
    }
    let answer;
    try {
      answer = decodeDatasetQueryAnswer(
        job,
        await wait(() => ports.execute(job, abort.signal)),
      );
    } catch (error) {
      if (error instanceof DatasetReadError || abort.signal.aborted)
        throw error;
      throw new DatasetReadError("invalid_dataset");
    }
    // Recheck authority and every dependency after the controller has finished.
    for (const dep of model.dependencies)
      await wait(() =>
        reads.read(
          context,
          {
            binding: request.binding,
            schema: dep.schema,
            table: dep.name,
            offset: 0,
            limit: 1,
            expectedVersion: binding.revision.version,
            expectedGeneration: binding.revision.generation,
          },
          abort.signal,
        ),
      );
    await wait(() => authorize(abort.signal));
    const table = answer.tables.result;
    // Empty and all-null columns give the engine no scalar type evidence.
    // With exact names/order, recover only those types from the attestation;
    // every column containing a non-null value must retain strict inferred typing.
    if (
      table &&
      JSON.stringify(table.columns.map((c) => c.name)) ===
        JSON.stringify(model.columns.map((c) => c.name))
    )
      table.columns = table.columns.map((column, index) => ({
        name: column.name,
        type: table.rows.every((row) => row[column.name] === null)
          ? model.columns[index]!.type
          : column.type,
      }));
    if (
      !table ||
      Object.keys(answer.errors).length ||
      JSON.stringify(table.columns) !==
        JSON.stringify(
          model.columns.map((c) => ({ name: c.name, type: c.type })),
        )
    )
      throw new DatasetReadError("invalid_dataset");
    if (
      table.truncated ||
      (table.totalRows !== undefined && table.totalRows !== table.rows.length)
    )
      throw new DatasetReadError("result_limit");
    const result: DatasetReadResult = {
      version: binding.revision.version,
      generation: binding.revision.generation,
      schema: request.schema,
      table: request.table,
      columns: table.columns,
      rows: [],
      offset: request.offset,
      nextOffset: null,
      totalRows: table.rows.length,
    };
    for (
      let i = request.offset;
      i <
      Math.min(
        table.rows.length,
        request.offset + Math.min(request.limit, 100),
      );
      i++
    ) {
      result.rows.push(table.rows[i]! as DatasetReadResult["rows"][number]);
      result.nextOffset = i + 1 < table.rows.length ? i + 1 : null;
      if (Buffer.byteLength(JSON.stringify(result)) > DATASET_RESULT_BYTES) {
        result.rows.pop();
        result.nextOffset = i;
        if (!result.rows.length) throw new DatasetReadError("result_limit");
        break;
      }
    }
    if (Buffer.byteLength(JSON.stringify(result)) > DATASET_RESULT_BYTES)
      throw new DatasetReadError("result_limit");
    return result;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", forward);
    abort.abort();
  }
}
