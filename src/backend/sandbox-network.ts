import { BackendHostError } from "./contracts.ts";
import type {
  SandboxNetwork,
  SandboxNetworkOptions,
} from "./sandbox-network-contracts.ts";
/** Trust only an inspected IPv4 bridge that disables inter-container traffic. */
export function createSandboxNetwork(
  options: SandboxNetworkOptions,
): SandboxNetwork {
  const { network, identity, command, log } = options;
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(network))
    throw Error("Invalid sandbox network");
  async function prepareNetwork(): Promise<void> {
    const inspect = async () =>
      JSON.parse(
        (
          await command(
            ["network", "inspect", "--format", "{{json .}}", network],
            5000,
          )
        ).stdout,
      );
    let found: any;
    try {
      found = await inspect();
    } catch (e: any) {
      if (!/not found|No such network/i.test(e?.stderr ?? "")) throw e;
      try {
        await command(
          [
            "network",
            "create",
            "--driver=bridge",
            "--ipv6=false",
            "--label=" + identity.namespace + ".sandbox=1",
            "--opt=com.docker.network.bridge.enable_icc=false",
            ...(network === identity.network
              ? ["--opt=com.docker.network.bridge.name=" + identity.bridge]
              : []),
            network,
          ],
          10000,
        );
      } catch {
        // Another host may have created it first; the inspection below decides.
      }
      found = await inspect();
    }
    const options = found?.Options ?? {};
    if (
      found?.Driver !== "bridge" ||
      found?.EnableIPv6 !== false ||
      options["com.docker.network.bridge.enable_icc"] !== "false" ||
      (network === identity.network &&
        options["com.docker.network.bridge.name"] !== identity.bridge)
    ) {
      log(
        `sandbox network ${network} is not an IPv4-only bridge without inter-container traffic` +
          (network === identity.network
            ? " on interface " + identity.bridge
            : "") +
          "; lambdas stay unavailable until it is removed or fixed",
      );
      throw Error("sandbox network mismatch");
    }
  }
  let networkReady: Promise<void> | undefined;
  /** The verified network; a failed check is tried again on the next call, never trusted. */
  function ensure(): Promise<void> {
    if (network === "none") return Promise.resolve();
    networkReady ??= prepareNetwork().catch(() => {
      networkReady = undefined;
      throw new BackendHostError("backend_unavailable");
    });
    return networkReady;
  }
  return {
    ensure,
    invalidate() {
      networkReady = undefined;
    },
  };
}
