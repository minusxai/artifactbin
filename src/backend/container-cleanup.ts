import type { RemoveBackendContainer } from "./container-cleanup-contracts.ts";
const missing = (error: unknown) => {
  const failure = error as {
    stderr?: string;
    killed?: boolean;
    signal?: string;
    code?: string | number;
  };
  return (
    !failure?.killed &&
    !failure?.signal &&
    failure?.code !== "ETIMEDOUT" &&
    /No such container|No such object/i.test(failure?.stderr ?? "")
  );
};
export const removeBackendContainer: RemoveBackendContainer = async (
  docker,
  name,
) => {
  try {
    try {
      await docker(["rm", "-f", name], 5000);
    } catch {
      /* Another remover can win; inspection below is the proof. */
    }
    try {
      await docker(["inspect", name], 5000);
      return false;
    } catch (error) {
      return missing(error);
    }
  } catch {
    return false;
  }
};
