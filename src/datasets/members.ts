import { DatasetReadError, DATASET_RESULT_BYTES } from "./contracts.ts";
import type {
  DatasetMembersPorts,
  DatasetMembersService,
} from "./members-contracts.ts";
/** Membership never accepts an artifact ID or directory from the page script. */
export function createDatasetMembersService(
  ports: DatasetMembersPorts,
): DatasetMembersService {
  return {
    async members(context) {
      const initial = await ports.snapshot(context);
      if (!initial) throw new DatasetReadError("denied");
      if (
        !/^[a-f0-9]{64}$/.test(initial.generation) ||
        initial.rows.length > 10000 ||
        initial.rows.some(
          (row) =>
            typeof row.user_id !== "string" ||
            !row.user_id ||
            typeof row.joined_at !== "string" ||
            !Number.isFinite(Date.parse(row.joined_at)),
        )
      )
        throw new DatasetReadError("invalid_dataset");
      if (
        new TextEncoder().encode(JSON.stringify(initial)).length >
        DATASET_RESULT_BYTES
      )
        throw new DatasetReadError("result_limit");
      const fresh = await ports.snapshot(context);
      if (!fresh) throw new DatasetReadError("denied");
      if (fresh.generation !== initial.generation)
        throw new DatasetReadError("dataset_changed");
      return structuredClone(initial);
    },
  };
}
