// Start the Pagegi server: `npm start`. Settings come from the environment
// through src/config.js (ServerMainEnv in src/server/af-api-contracts.ts).
import { listenConfig, serviceConfig } from "./config.js";
import { createService } from "./server.js";

const { host, port } = listenConfig();
const service = createService(serviceConfig());
service.server.listen(port, host, () => {
  const address = service.server.address();
  const bound = typeof address === "object" && address ? address.port : port;
  console.log(JSON.stringify({ server: `http://${host}:${bound}` }));
});
let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => {
    if (stopping) return;
    stopping = true;
    service.server.close();
    service.server.closeAllConnections();
    service.close().then(
      () => process.exit(0),
      (error) => {
        console.error(error instanceof Error ? error.message : error);
        process.exit(1);
      },
    );
  });
