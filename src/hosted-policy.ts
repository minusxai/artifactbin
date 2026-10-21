import type { HostedConfig, HostedRequest } from "./hosted-contracts.ts";
const invalid = () =>
  Object.assign(new Error("Invalid host configuration or request"), {
    status: 403,
  });
function origins(config: HostedConfig) {
  if (!config.platformOrigin || !config.runnerOrigin) throw invalid();
  const platform = new URL(config.platformOrigin),
    runner = new URL(
      config.runnerOrigin.replace("{document}", "pagegi-document"),
    );
  if (
    platform.origin !== config.platformOrigin ||
    platform.protocol !== "https:" ||
    runner.protocol !== "https:" ||
    runner.username ||
    runner.password ||
    runner.pathname !== "/" ||
    runner.search ||
    runner.hash ||
    config.runnerOrigin !==
      runner.origin.replace("pagegi-document", "{document}") ||
    config.runnerOrigin.split("{document}").length !== 2 ||
    !runner.hostname.startsWith("pagegi-document.") ||
    runner.hostname.endsWith("." + platform.hostname) ||
    runner.hostname === platform.hostname
  )
    throw invalid();
  return { platform, runner };
}
/**
 * A host label for a file ID. IDs are case-sensitive and host names are not,
 * so the label is the ID's bytes in lowercase hex: distinct IDs never share a runner origin.
 */
export function runnerLabel(id: string): string {
  if (!/^[A-Za-z0-9]{6}$/.test(id)) throw invalid();
  return [...id]
    .map((character) => character.charCodeAt(0).toString(16).padStart(2, "0"))
    .join("");
}
export function runnerAddress(document: string, config: HostedConfig): string {
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(document)) throw invalid();
  origins(config);
  return config.runnerOrigin!.replace("{document}", document) + "/runner";
}
export function hostedRequest(
  host: string,
  port: number,
  config: HostedConfig,
): HostedRequest {
  if (config.platformOrigin || config.runnerOrigin) {
    const { platform, runner } = origins(config);
    if (host === platform.host)
      return { kind: "platform", origin: platform.origin };
    const suffix = runner.host.slice("pagegi-document".length);
    if (host.endsWith(suffix)) {
      const document = host.slice(0, -suffix.length);
      if (/^[a-z0-9][a-z0-9-]{0,62}$/.test(document))
        return {
          kind: "runner",
          origin: new URL(runnerAddress(document, config)).origin,
          document,
        };
    }
    throw invalid();
  }
  if (!["127.0.0.1", "localhost"].some((name) => host === `${name}:${port}`))
    throw invalid();
  return { kind: "platform", origin: `http://${host}` };
}
