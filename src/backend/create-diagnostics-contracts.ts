/** Internal diagnostics contain only allowlisted metadata, never command text or runtime output. */
export interface BackendCreateDiagnostic {
  event: "backend_create_failed";
  stage: "compile" | "warm" | "warm_network_retry";
  category: "aborted" | "timeout" | "terminated" | "exit" | "spawn" | "unknown";
  reason?:
    | "network_missing"
    | "image_missing"
    | "name_conflict"
    | "disk_exhausted"
    | "resource_exhausted"
    | "daemon_unavailable";
  exitCode?: number;
  signal?: "SIGTERM" | "SIGKILL" | "SIGINT" | "SIGABRT";
  systemCode?: "ENOENT" | "EACCES" | "EPERM" | "EAGAIN" | "ENOMEM";
}
export interface ObserveBackendCreate {
  <T>(
    stage: BackendCreateDiagnostic["stage"],
    create: () => Promise<T>,
    log: (line: string) => void,
  ): Promise<T>;
}
