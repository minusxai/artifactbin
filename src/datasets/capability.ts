import { BackendDatasetChangedError } from "../backend/contracts.ts";
import type {
  BackendCapabilityHandler,
  BackendJson,
} from "../backend/contracts.ts";
import {
  DatasetReadError,
  type DatasetReadService,
  type DatasetCallContext,
} from "./contracts.ts";
/** Captures the saved backend/page context once; the sandbox cannot select an authority. */
export function datasetCapabilityHandler(
  service: DatasetReadService,
  context: DatasetCallContext,
  fallback: BackendCapabilityHandler,
): BackendCapabilityHandler {
  const bound = Object.freeze({ ...context });
  return async (principal, request, signal) => {
    if (request.kind !== "dataset") return fallback(principal, request, signal);
    if (
      principal.tenant !== bound.pageId ||
      principal.subject !== bound.subject
    )
      throw new DatasetReadError("denied");
    let result;
    try {
      result = await service.read(bound, request.input, signal);
    } catch (error) {
      if (
        error instanceof DatasetReadError &&
        (error as { code: string }).code === "dataset_changed"
      )
        throw new BackendDatasetChangedError();
      throw error;
    }
    return JSON.parse(JSON.stringify(result)) as BackendJson;
  };
}
