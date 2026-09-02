import net from 'node:net';

/** Return true when a TCP listener can claim this port on the same wildcard host as server.ts. */
export async function portIsAvailable(port) {
  if (!Number.isInteger(Number(port)) || Number(port) < 1 || Number(port) > 65535) return false;
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', (error) => {
      if (error?.code === 'EADDRINUSE' || error?.code === 'EACCES') resolve(false);
      else reject(error);
    });
    server.listen(port, () => server.close((error) => error ? reject(error) : resolve(true)));
  });
}

/** The app and Vite websocket must both be free before a development boot starts. */
export async function unavailableDevelopmentPorts(appPort, hmrPort = appPort + 1) {
  const ports = [...new Set([appPort, hmrPort])];
  const availability = await Promise.all(ports.map((port) => portIsAvailable(port)));
  return ports.filter((_port, index) => !availability[index]);
}

/** Find the first adjacent app/HMR pair, beginning after the rejected app port. */
export async function nextAvailableDevelopmentPair(afterPort) {
  for (let appPort = Math.max(1, Number(afterPort) + 1); appPort < 65535; appPort += 1) {
    if ((await unavailableDevelopmentPorts(appPort, appPort + 1)).length === 0) {
      return { appPort, hmrPort: appPort + 1 };
    }
  }
  return null;
}
