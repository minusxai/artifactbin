import { remoteImageProcessor } from "./media/image-processing/remote.ts";
import { readFileSync } from "node:fs";
import { KNOWN_AF_ORIGINS } from "./af-contracts.ts";
import { createBackendHost } from "./backend/container-host.ts";
import { remoteDatasetSqlExecutor } from "./backend/dataset-sql-transport.ts";
import { remoteBackendHost } from "./backend/execution-service.ts";
import { loadResourceConfiguration } from "./connectors/config.ts";
import { withCapabilityAuthority } from "./backend/capability-authority.ts";
import { parseSecretsKey } from "./server/secrets.ts";
/** Where src/server-main.js listens: PAGEGI_HOST (default 127.0.0.1) and PAGEGI_PORT (default 8787). */
export function listenConfig(env = process.env) {
  const port = Number(env.PAGEGI_PORT || "8787");
  if (!Number.isSafeInteger(port) || port < 0 || port > 65535)
    throw Error("PAGEGI_PORT must be a TCP port");
  return { host: env.PAGEGI_HOST || "127.0.0.1", port };
}
/** Only this adapter reads server environment settings. */
export function serviceConfig(env = process.env) {
  if (
    env.PAGEGI_TEST_LOGIN !== undefined &&
    !["", "0", "1"].includes(env.PAGEGI_TEST_LOGIN)
  )
    throw Error("PAGEGI_TEST_LOGIN must be 1 to enable test login, or unset");
  const knownOrigins = (env.PAGEGI_KNOWN_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  for (const origin of knownOrigins)
    if (new URL(origin).origin !== origin)
      throw Error("PAGEGI_KNOWN_ORIGINS lists origins without paths");
  if (
    env.PAGEGI_BACKEND_EXECUTOR &&
    !["docker", "remote"].includes(env.PAGEGI_BACKEND_EXECUTOR)
  )
    throw Error("Unsupported backend execution adapter");
  const key = env.PAGEGI_RESEND_API_KEY,
    from = env.PAGEGI_EMAIL_FROM;
  if (Boolean(key) !== Boolean(from))
    throw Error("Configure both PAGEGI_RESEND_API_KEY and PAGEGI_EMAIL_FROM");
  let backendHost, datasetSqlExecutor, datasetImageProcessor;
  if (env.PAGEGI_BACKEND_EXECUTOR === "remote") {
    let secret = env.PAGEGI_EXECUTION_SECRET;
    if (env.PAGEGI_EXECUTION_SECRET_FILE) {
      try {
        secret = readFileSync(env.PAGEGI_EXECUTION_SECRET_FILE, "utf8").trim();
      } catch {
        throw Error("Unable to read execution secret file");
      }
    }
    if (
      (!env.PAGEGI_EXECUTION_ENDPOINT && !env.PAGEGI_EXECUTION_SOCKET) ||
      !secret
    )
      throw Error("Configure execution transport and secret");
    const transport = {
      endpoint: env.PAGEGI_EXECUTION_ENDPOINT,
      socketPath: env.PAGEGI_EXECUTION_SOCKET,
      secret,
    };
    if (env.PAGEGI_DATASET_ATTACHMENT_DIRECTORY)
      datasetImageProcessor = remoteImageProcessor({ ...transport, endpoint: transport.endpoint || "http://localhost" });
    if (env.PAGEGI_DATASET_MUTATION_DIRECTORY)
      datasetSqlExecutor = remoteDatasetSqlExecutor(transport);
    backendHost = remoteBackendHost({
      endpoint: env.PAGEGI_EXECUTION_ENDPOINT,
      socketPath: env.PAGEGI_EXECUTION_SOCKET,
      secret,
    });
  } else if (env.PAGEGI_BACKEND_EXECUTOR === "docker") {
    backendHost = createBackendHost({
      image: env.PAGEGI_BACKEND_IMAGE,
      sandboxNetwork: env.PAGEGI_SANDBOX_NETWORK || undefined,
    });
  }
  if (
    env.PAGEGI_DATASET_MUTATION_DIRECTORY &&
    (!datasetSqlExecutor || !env.PAGEGI_DATASET_DIRECTORY)
  )
    throw Error(
      "Dataset mutation storage requires remote execution and source storage",
    );
  if (env.PAGEGI_DATASET_ATTACHMENT_DIRECTORY && !datasetImageProcessor)
    throw Error("Dataset attachment storage requires authenticated remote image processing");
  if (env.PAGEGI_RESOURCE_CONFIG) {
    if (!backendHost)
      throw Error("Resource configuration requires backend execution");
    const resources = loadResourceConfiguration(env.PAGEGI_RESOURCE_CONFIG, {
      env,
    });
    backendHost = withCapabilityAuthority(backendHost, resources);
  }
  // Account secrets need a key; without one the routes answer 503 and lambdas get an empty env.
  const secretsKey = env.PAGEGI_SECRETS_KEY
    ? parseSecretsKey(env.PAGEGI_SECRETS_KEY)
    : undefined;
  if (!secretsKey && env.NODE_ENV === "production")
    console.error(
      "PAGEGI_SECRETS_KEY is not set: account secrets are unavailable (/api/secrets answers 503)",
    );
  return {
    connectionString: env.PAGEGI_DATABASE_URL,
    ...(env.PAGEGI_MEDIA_DIRECTORY
      ? { mediaDirectory: env.PAGEGI_MEDIA_DIRECTORY }
      : {}),
    ...(env.PAGEGI_DATASET_DIRECTORY
      ? { datasetDirectory: env.PAGEGI_DATASET_DIRECTORY }
      : {}),
    ...(backendHost ? { backendHost } : {}),
    ...(datasetImageProcessor ? { datasetImageProcessor, datasetAttachmentDirectory: env.PAGEGI_DATASET_ATTACHMENT_DIRECTORY } : {}),
    ...(datasetSqlExecutor
      ? {
          datasetSqlExecutor,
          datasetMutationDirectory: env.PAGEGI_DATASET_MUTATION_DIRECTORY,
        }
      : {}),
    ...(secretsKey ? { secretsKey } : {}),
    schema: env.PAGEGI_DATABASE_SCHEMA || "public",
    platformOrigin: env.PAGEGI_PLATFORM_ORIGIN,
    runnerOrigin: env.PAGEGI_RUNNER_ORIGIN,
    allowPasswordLogin: env.PAGEGI_PASSWORD_LOGIN !== "false",
    testLogin: env.PAGEGI_TEST_LOGIN === "1",
    knownOrigins: [...KNOWN_AF_ORIGINS, ...knownOrigins],
    ...(key
      ? {
          sendCode: async ({ to, code }) => {
            const response = await fetch("https://api.resend.com/emails", {
              method: "POST",
              signal: AbortSignal.timeout(10000),
              headers: {
                Authorization: `Bearer ${key}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                from,
                to: [to],
                // The same shape as Artifactbin's login email, which reaches inboxes at once.
                subject: `${code} is your artifactbin sign-in code`,
                text: `Your artifactbin sign-in code is ${code}\n\nIt expires in 10 minutes. If you didn't ask to sign in, ignore this email.`,
                html: `<div style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:15px;line-height:1.6;color:#0b0e11"><p>Your artifactbin sign-in code is</p><p style="font-size:32px;font-weight:600;letter-spacing:0.18em;margin:16px 0">${code}</p><p style="color:#57606a">It expires in 10 minutes. If you didn't ask to sign in, ignore this email.</p></div>`,
              }),
            });
            if (!response.ok) throw Error("Email provider rejected delivery");
          },
        }
      : {}),
  };
}
