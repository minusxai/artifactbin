import { createStoredModelResolver } from "../persistence/dataset-stored-models.ts";
import{createSourceQueryService}from"../datasets/source-query/service.ts";
import{createSourceQueryRepository}from"../persistence/source-queries.ts";
import { createDatasetAttachmentContext } from "../persistence/dataset-attachment-context.ts";
import { createDatasetAttachmentRepository } from "../persistence/dataset-attachments.ts";
import { createDatasetAttachmentStorage } from "../persistence/dataset-attachment-storage.ts";
import { createDatasetAttachmentService } from "../datasets/attachments/service.ts";
import { createDatasetMutationAvailabilityService } from "../datasets/mutation/availability.ts";
import { createDatasetMutationAvailabilityRepository } from "../persistence/dataset-mutations.ts";
import { createDatasetViewerService } from "../datasets/viewer.ts";
import { createDatasetViewerRepository } from "../persistence/dataset-viewer.ts";
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
        ...(executor?.query
          ? {
              models: {
                resolve: createStoredModelResolver(database),
                execute: executor.query.bind(executor),
              },
            }
          : {}),
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
  const { attachmentDirectory, imageProcessor } = options;
  if (Boolean(attachmentDirectory) !== Boolean(imageProcessor))
    throw Error(
      "Dataset attachment storage requires an isolated image processor",
    );
  const attachments =
    attachmentDirectory && imageProcessor
      ? {
          resolve: createDatasetAttachmentContext(database, now),
          service: createDatasetAttachmentService({
            repository: createDatasetAttachmentRepository({ database, now }),
            storage: createDatasetAttachmentStorage({
              directory: attachmentDirectory,
              processor: imageProcessor,
            }),
          }),
        }
      : undefined;
  let closing: Promise<void> | undefined;
  return {
    reads,
    ...(options.sourceQueryResources?{sourceQueries:createSourceQueryService(createSourceQueryRepository(database,options.sourceQueryResources.pool,now))}:{}),
    ...(attachments ? { attachments } : {}),
    availability: createDatasetMutationAvailabilityService(
      createDatasetMutationAvailabilityRepository(database, now),
    ),
    person: createDatasetPersonService({
      ...createDatasetPersonRepository(database),
      reads,
    }),
    viewer: createDatasetViewerService(
      createDatasetViewerRepository(database, now),
    ),
    members: createDatasetMembersService(
      createDatasetMembersRepository(database, now),
    ),
    ...(mutations ? { mutations } : {}),
    close: () =>
      (closing ??= Promise.allSettled(
        [
          () => options.sourceQueryResources?.close(),
          () => executor?.close(),
          () => imageProcessor?.close(),
        ].map((close) => Promise.resolve().then(close)),
      ).then((results) => {
        const failed = results.find((result) => result.status === "rejected");
        if (failed?.status === "rejected") throw failed.reason;
      })),
  };
}
