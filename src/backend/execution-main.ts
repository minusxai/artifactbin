import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { createBackendHost } from "./container-host.ts";
import { createExecutionService } from "./execution-service.ts";
import { dockerCommand, reapBackendContainers } from "./reaper.ts";
const secretFile = process.env.PAGEGI_EXECUTION_SECRET_FILE;
if (!secretFile) throw Error("PAGEGI_EXECUTION_SECRET_FILE is required");
const bind = process.env.PAGEGI_EXECUTION_BIND ?? "127.0.0.1";
const port = Number(process.env.PAGEGI_EXECUTION_PORT ?? "8788");
if (!Number.isSafeInteger(port) || port < 1 || port > 65535)
  throw Error("Invalid execution port");
const service = createExecutionService({
  host: createBackendHost({
    image: process.env.PAGEGI_BACKEND_IMAGE,
    sandboxNetwork: process.env.PAGEGI_SANDBOX_NETWORK || undefined,
  }),
  secret: readFileSync(secretFile, "utf8").trim(),
});
const server = createServer(
  // A request stays open for its whole operation (duplex frames), so this outlasts the 40 s deadline.
  { headersTimeout: 5000, requestTimeout: 45000, maxHeaderSize: 8192 },
  service,
);
server.maxConnections = 64;
// Containers a previous controller left behind are removed before any request is admitted;
// a cleanup that cannot be verified keeps the controller closed.
try {
  const reaped = await reapBackendContainers(dockerCommand);
  console.log(JSON.stringify({ execution: "cleanup verified", reaped }));
} catch {
  console.error("Execution container cleanup failed; admission must remain stopped");
  process.exit(1);
}
const socketPath = process.env.PAGEGI_EXECUTION_SOCKET;
if (socketPath) {
  if (!socketPath.startsWith("/") || socketPath.includes("\0"))
    throw Error("Invalid execution socket path");
  if (process.env.PAGEGI_EXECUTION_BIND || process.env.PAGEGI_EXECUTION_PORT)
    throw Error("Socket and TCP bind configuration are mutually exclusive");
  process.umask(0o007);
  server.listen(socketPath);
} else server.listen(port, bind);
let shutdown: Promise<void> | undefined;
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.on(signal, () => {
    if (shutdown) return;
    const watchdog = setTimeout(() => process.exit(1), 20000);
    watchdog.unref();
    shutdown = Promise.all([
      service.close(),
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
    ]).then(
      () => {
        clearTimeout(watchdog);
      },
      () => {
        clearTimeout(watchdog);
        process.exitCode = 1;
        console.error("Execution controller cleanup failed");
      },
    );
  });
