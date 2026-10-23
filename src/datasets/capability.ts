import { DatasetMutationError } from "./mutation/contracts.ts";
import {
  BackendDatasetChangedError,
  BackendDatasetMutationRejectedError,
} from "../backend/contracts.ts";
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
  mutations?: import("./mutation/contracts.ts").DatasetMutationService,
  members?: import("./members-contracts.ts").DatasetMembersService,
  person?: import("./person-contracts.ts").DatasetPersonService,
  viewer?: import("./viewer-contracts.ts").DatasetViewerService,
  availability?: import("./mutation/availability-contracts.ts").DatasetMutationAvailabilityService,
  sourceQueries?: import("./source-query/contracts.ts").SourceQueryService,
  userChoices?: import("./user-choices/contracts.ts").DatasetUserChoiceService,
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
      if(request.operation === "userChoices" && userChoices)
        result=await userChoices.userChoices(bound,request.input,signal);
      else if(request.operation === "sourceQueryAvailability" && sourceQueries)
        result=await sourceQueries.availability(bound,request.input,signal);
      else if (request.operation === "sourceQuery" && sourceQueries)
        result = await sourceQueries.query(bound, request.input, signal);
      else if (request.operation === "read")
        result = await service.read(bound, request.input, signal);
      else if (request.operation === "members" && members)
        result = await members.members(bound, signal);
      else if (request.operation === "viewer" && viewer)
        result = await viewer.viewer(bound, signal);
      else if (request.operation === "person" && person)
        result = await person.person(bound, request.input, signal);
      else if(request.operation === "mutationAvailability" && availability)
        result=await availability.mutationAvailability(bound,request.input,signal);
      else if (request.operation === "mutate" && mutations)
        result = await mutations.mutate(bound, request.input, signal);
      else throw new DatasetReadError("denied");
    } catch (error) {
      if (error instanceof DatasetReadError && error.code === "dataset_changed")
        throw new BackendDatasetChangedError();
      if (error instanceof DatasetMutationError && error.outcome === "rejected")
        throw new BackendDatasetMutationRejectedError();
      throw error;
    }

    return JSON.parse(JSON.stringify(result)) as BackendJson;
  };
}
