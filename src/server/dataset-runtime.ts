import { createDatasetPersonService } from "../datasets/person.ts";
import { createDatasetPersonRepository } from "../persistence/dataset-person.ts";
import { createDatasetMembersService } from "../datasets/members.ts";
import { createDatasetMembersRepository } from "../persistence/dataset-members.ts";
import { createReadonlyDatasetObjectStore } from "../datasets/object-store.ts";
import { createDatasetMutationObjectStore } from "../datasets/mutation/object-store.ts";
import { createDatasetReadRepository } from "../persistence/datasets.ts";
import { createDatasetMutationRepository } from "../persistence/dataset-mutations.ts";
import { createDatasetReadService } from "../datasets/service.ts";
import { createDatasetMutationService } from "../datasets/mutation/service.ts";
import { readRows } from "../datasets/rows.ts";
import { DatasetReadError } from "../datasets/contracts.ts";
import type {
  DatasetRuntime,
  DatasetRuntimeOptions,
} from "./dataset-runtime-contracts.ts";
/** App-only composition. SQL is delegated exclusively to the authenticated execution-controller port. */
export function createDatasetRuntime(
  options: DatasetRuntimeOptions,
): DatasetRuntime {
  const { database, sourceDirectory, mutationDirectory, executor, now } =
    options;
  if (
    Boolean(mutationDirectory) !== Boolean(executor) ||
    (mutationDirectory && !sourceDirectory)
  )
    throw Error(
      "Dataset mutations require source storage, writable overlay and remote execution",
    );
  const source = sourceDirectory
    ? createReadonlyDatasetObjectStore(sourceDirectory)
    : undefined;
  const overlay = mutationDirectory
    ? createDatasetMutationObjectStore(mutationDirectory, source)
    : undefined;
  const objects = overlay ?? source;
  const reads = objects
    ? createDatasetReadService({
        ...createDatasetReadRepository(database, now),
        read: objects.read,
      })
    : {
        read: async () => {
          throw new DatasetReadError("denied");
        },
      };
  const mutations =
    overlay && executor
      ? createDatasetMutationService({
          ...createDatasetMutationRepository({
            database,
            objects: overlay,
            now,
          }),
          read: async (table) =>
            readRows(table, await overlay.read(table.object.key)),
          persist: (rows) => overlay.persist(rows),
          execute: (job, signal) => executor.execute(job, signal),
        })
      : undefined;
  let closing: Promise<void> | undefined;
  return {
    reads,
    person: createDatasetPersonService({
      ...createDatasetPersonRepository(database),
      reads,
    }),
    members: createDatasetMembersService(
      createDatasetMembersRepository(database, now),
    ),
    ...(mutations ? { mutations } : {}),
    close: () => (closing ??= executor?.close() ?? Promise.resolve()),
  };
}
