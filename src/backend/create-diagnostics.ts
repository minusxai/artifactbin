import type {
  BackendCreateDiagnostic,
  ObserveBackendCreate,
} from "./create-diagnostics-contracts.ts";
/** execFile's killed flag alone does not distinguish timeout from other termination. */
export const observeBackendCreate: ObserveBackendCreate = async (
  stage,
  create,
  log,
) => {
  try {
    return await create();
  } catch (error) {
    const failure = error as {
      code?: unknown;
      signal?: unknown;
      killed?: unknown;
      stderr?: unknown;
    } | null;
    const code = failure?.code;
    const signal = failure?.signal;
    const diagnostic: BackendCreateDiagnostic = {
      event: "backend_create_failed",
      stage,
      category: "unknown",
    };
    if (code === "ABORT_ERR") diagnostic.category = "aborted";
    else if (code === "ETIMEDOUT") diagnostic.category = "timeout";
    else if (
      failure?.killed === true ||
      signal === "SIGTERM" ||
      signal === "SIGKILL" ||
      signal === "SIGINT" ||
      signal === "SIGABRT"
    )
      diagnostic.category = "terminated";
    else if (
      typeof code === "number" &&
      Number.isSafeInteger(code) &&
      code >= 0 &&
      code <= 255
    ) {
      diagnostic.category = "exit";
      diagnostic.exitCode = code;
    } else if (
      code === "ENOENT" ||
      code === "EACCES" ||
      code === "EPERM" ||
      code === "EAGAIN" ||
      code === "ENOMEM"
    ) {
      diagnostic.category = "spawn";
      diagnostic.systemCode = code;
    }
    if (
      signal === "SIGTERM" ||
      signal === "SIGKILL" ||
      signal === "SIGINT" ||
      signal === "SIGABRT"
    )
      diagnostic.signal = signal;
    // Match only anchored Docker CLI/daemon diagnostics; never emit captured content.
    const stderr = failure?.stderr;
    if (typeof stderr === "string" && stderr.length <= 65536) {
      const text = stderr.trim();
      if (
        /^Error response from daemon: network [^\r\n]+ not found\.?$/i.test(
          text,
        )
      )
        diagnostic.reason = "network_missing";
      else if (
        /^Error response from daemon: No such image: [^\r\n]+$/i.test(text)
      )
        diagnostic.reason = "image_missing";
      else if (
        /^Error response from daemon: Conflict\. The container name "[^"\r\n]+" is already in use by container "[^"\r\n]+"\.[^\r\n]*$/i.test(
          text,
        )
      )
        diagnostic.reason = "name_conflict";
      else if (
        /^Error response from daemon: [^\r\n]*\bno space left on device\.?$/i.test(
          text,
        )
      )
        diagnostic.reason = "disk_exhausted";
      else if (
        /^Error response from daemon: [^\r\n]*\b(resource temporarily unavailable|cannot allocate memory)\.?$/i.test(
          text,
        )
      )
        diagnostic.reason = "resource_exhausted";
      else if (
        /^Cannot connect to the Docker daemon at [^\r\n]+\. Is the docker daemon running\?$/i.test(
          text,
        )
      )
        diagnostic.reason = "daemon_unavailable";
    }
    try {
      log(JSON.stringify(diagnostic));
    } catch {
      /* Diagnostics cannot change cleanup or the original error. */
    }
    throw error;
  }
};
