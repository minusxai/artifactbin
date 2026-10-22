import { datasetCapabilityHandler } from "../datasets/capability.ts";
/**
 * Backend files: compile and version them with the page that links them, and
 * serve the page's backend routes (contract: ./af-backend-contracts.ts).
 * Execution reuses the isolated BackendHost; nothing here runs author code.
 */
import { FILE_ID_PATTERN, type AfJson, type FileId } from "../af-contracts.ts";
import {
  FieldFailed,
  FieldNotExecuted,
  type FieldCall,
  type PageCaller,
  type RemoteRequest,
} from "../graphql/af-namespace-contracts.ts";
import {
  composePageSchema,
  executePageOperation,
} from "../graphql/af-namespaces.ts";
import type {
  AfRouteModule,
  AfRouteRequest,
  AfRouteResponse,
} from "../server/af-api-contracts.ts";
import type { BackendLink } from "../page/page-contracts.ts";
import {
  BackendModuleError,
  type BackendFilesPort,
  type BackendsResponse,
  type LinkedBackend,
  type SqlClient,
  type SqlDatabase,
} from "./af-backend-contracts.ts";
import { readBackendModule } from "./af-module.ts";
import { createBackendStore } from "./af-store.ts";
import { isCurrentRuntime } from "./deployment.ts";
import {
  BackendHostError,
  type BackendEnv,
  type BackendErrorCode,
  type BackendHost,
  type CompiledBackend,
} from "./contracts.ts";
import type { SecretsEnvPort } from "../server/secrets-contracts.ts";

const SOURCE_BYTES = 262144;
const GRAPHQL_NAME = /^[_A-Za-z][_0-9A-Za-z]*$/;
const MAX_FILES = 64;
/** Host failures that prove the resolver never started, or (store_limit) that nothing was saved. */
const NOT_STARTED: ReadonlySet<BackendErrorCode> = new Set([
  "input_quota",
  "field_rejected",
  "deployment_invalid",
  "backend_busy",
  "store_limit",
]);
/** Host failures worth retrying as they are; they say nothing about the backend itself. */
const TRANSIENT: ReadonlySet<BackendErrorCode> = new Set([
  "backend_busy",
  "backend_unavailable",
  "cancelled",
  "deadline",
  "cleanup_failed",
]);

/** Prefix the failing file's ID so the server can name it; messages never carry source or diagnostics. */
function forFile<E extends Error>(
  id: FileId,
  error: E,
): E & { fileId: FileId } {
  error.message = `${id}: ${error.message}`;
  return Object.assign(error, { fileId: id });
}

export function createBackendFiles(options: {
  host?: BackendHost;
}): BackendFilesPort {
  const { host } = options;
  return {
    async compile(files, signal) {
      const entries = Object.entries(files ?? {});
      if (entries.length > MAX_FILES)
        throw Error(
          `A page publishes at most ${MAX_FILES} backend files at once`,
        );
      const compiled: Record<FileId, CompiledBackend> = {};
      // One at a time: the host admits a few concurrent containers and refuses the rest.
      for (const [id, source] of entries) {
        if (!FILE_ID_PATTERN.test(id))
          throw Error(`Invalid file ID ${JSON.stringify(id)}`);
        if (
          typeof source !== "string" ||
          Buffer.byteLength(source) > SOURCE_BYTES
        )
          throw forFile(id, new BackendHostError("source_quota"));
        let typeDefs: string;
        try {
          ({ typeDefs } = await readBackendModule(source));
        } catch (error) {
          throw error instanceof Error ? forFile(id, error) : error;
        }
        if (!host)
          throw forFile(id, new BackendHostError("backend_unavailable"));
        let deployment: CompiledBackend;
        try {
          deployment = await host.compile(source, signal);
        } catch (error) {
          throw error instanceof Error ? forFile(id, error) : error;
        }
        if (deployment.typeDefs !== typeDefs)
          throw forFile(
            id,
            new BackendModuleError(
              "typedefs-not-static",
              "typeDefs at runtime differs from the file's static typeDefs",
            ),
          );
        compiled[id] = deployment;
      }
      return compiled;
    },

    async record(client, input) {
      const { owner, pageId, pageVersion, links, compiled } = input;
      if (typeof owner !== "string" || !owner)
        throw Error("An owner is required");
      if (!FILE_ID_PATTERN.test(pageId)) throw Error("Invalid page ID");
      if (!Number.isSafeInteger(pageVersion) || pageVersion < 1)
        throw Error("Invalid page version");
      const linked = validLinks(links);
      for (const id of Object.keys(compiled))
        if (!linked.some((link) => link.id === id))
          throw forFile(id, Error("is not linked from the page"));

      for (const [id, deployment] of Object.entries(compiled)) {
        // The version names the source and schema (deployment.ts). Republishing
        // the same source keeps it, and the fresh compile replaces the stored one.
        const file = await client.query(
          `INSERT INTO af_backend_files (file_id, owner, head_version)
           VALUES ($1, $2, $3)
           ON CONFLICT (file_id) DO UPDATE SET head_version = EXCLUDED.head_version, updated_at = now()
           WHERE af_backend_files.owner = EXCLUDED.owner
           RETURNING file_id`,
          [id, owner, deployment.version],
        );
        if (!file.rowCount)
          throw forFile(id, Error("belongs to another account"));
        await client.query(
          `INSERT INTO af_backend_versions (file_id, version, page_id, page_version, type_defs, deployment)
           VALUES ($1, $2, $3, $4, $5, $6::jsonb)
           ON CONFLICT (file_id, version) DO UPDATE SET deployment = EXCLUDED.deployment`,
          [
            id,
            deployment.version,
            pageId,
            pageVersion,
            deployment.typeDefs,
            JSON.stringify(deployment),
          ],
        );
      }
      const heads = await fileHeads(
        client,
        linked.map((link) => link.id),
      );
      for (const link of linked)
        if (!heads.has(link.id))
          throw forFile(link.id, Error("is not a published backend file"));

      if (linked.length) {
        await client.query(
          `INSERT INTO af_backend_pages (page_id, page_version) VALUES ($1, $2)
           ON CONFLICT (page_id) DO UPDATE SET page_version = EXCLUDED.page_version
           WHERE af_backend_pages.page_version < EXCLUDED.page_version`,
          [pageId, pageVersion],
        );
      } else {
        // Pages that never linked a backend keep no row; a page that dropped its links now has none current.
        await client.query(
          `UPDATE af_backend_pages SET page_version = $2 WHERE page_id = $1 AND page_version < $2`,
          [pageId, pageVersion],
        );
      }
      await client.query(
        `DELETE FROM af_page_backends WHERE page_id = $1 AND page_version = $2`,
        [pageId, pageVersion],
      );
      for (const [position, link] of linked.entries()) {
        const head = heads.get(link.id)!;
        await client.query(
          `INSERT INTO af_page_backends (page_id, page_version, position, name, file_id, version)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [pageId, pageVersion, position, link.name, link.id, head.version],
        );
      }
    },

    async owned(client, owner, ids) {
      const { rows } = await client.query(
        `SELECT file_id FROM af_backend_files WHERE owner = $1 AND file_id = ANY($2::text[])`,
        [owner, [...ids]],
      );
      return ids.filter((id) => rows.some((row) => row.file_id === id));
    },

    async head(client, id) {
      return (await fileHeads(client, [id])).get(id) ?? null;
    },

    async forgetPage(client, pageId) {
      await client.query(`DELETE FROM af_page_backends WHERE page_id = $1`, [
        pageId,
      ]);
      await client.query(`DELETE FROM af_backend_pages WHERE page_id = $1`, [
        pageId,
      ]);
    },

    async published(client, ids) {
      const { rows } = await client.query(
        `SELECT file_id FROM af_backend_files WHERE file_id = ANY($1::text[])`,
        [[...ids]],
      );
      return ids.filter((id) => rows.some((row) => row.file_id === id));
    },
  };
}

function validLinks(
  links: readonly BackendLink[],
): { name: string; id: FileId }[] {
  const names = new Set<string>();
  return links.map((link) => {
    if (
      !link ||
      typeof link.name !== "string" ||
      !GRAPHQL_NAME.test(link.name) ||
      names.has(link.name)
    )
      throw Error(
        `Invalid or duplicate backend name ${JSON.stringify(link?.name)}`,
      );
    if (typeof link.id !== "string" || !FILE_ID_PATTERN.test(link.id))
      throw Error(`Backend ${link.name} does not link a file ID`);
    names.add(link.name);
    return { name: link.name, id: link.id };
  });
}

async function fileHeads(client: SqlClient, ids: readonly FileId[]) {
  const { rows } = await client.query(
    `SELECT file_id, owner, head_version FROM af_backend_files WHERE file_id = ANY($1::text[])`,
    [[...ids]],
  );
  return new Map(
    rows.map((row) => [
      String(row.file_id),
      { owner: String(row.owner), version: String(row.head_version) },
    ]),
  );
}

interface CurrentLink extends LinkedBackend {
  /** The backend file's owner (af_backend_files.owner): whose secrets its resolvers get as `env`. */
  owner: string;
  deployment: CompiledBackend;
}

async function currentLinks(
  client: SqlClient,
  pageId: FileId,
): Promise<CurrentLink[]> {
  const { rows } = await client.query(
    `SELECT l.name, l.file_id, l.version, v.type_defs, v.deployment, f.owner
       FROM af_backend_pages p
       JOIN af_page_backends l ON l.page_id = p.page_id AND l.page_version = p.page_version
       JOIN af_backend_versions v ON v.file_id = l.file_id AND v.version = l.version
       JOIN af_backend_files f ON f.file_id = l.file_id
      WHERE p.page_id = $1
      ORDER BY l.position`,
    [pageId],
  );
  return rows.map((row) => ({
    name: String(row.name),
    id: String(row.file_id),
    version: String(row.version),
    typeDefs: String(row.type_defs),
    owner: String(row.owner),
    deployment: (typeof row.deployment === "string"
      ? JSON.parse(row.deployment)
      : row.deployment) as CompiledBackend,
  }));
}

const listing = (links: readonly CurrentLink[]): BackendsResponse => ({
  backends: links.map(({ name, id, version, typeDefs }) => ({
    name,
    id,
    version,
    typeDefs,
  })),
});

const reply = (status: number, body: unknown): AfRouteResponse => ({
  status,
  body,
});
const NOT_FOUND = reply(404, { error: "Not found" });
const ROUTE = /^\/api\/files\/([A-Za-z0-9]{6})\/(backends|graphql)$/;

function remoteRequest(body: AfRouteRequest["body"]): RemoteRequest | null {
  if (!body || typeof body !== "object" || typeof body.query !== "string")
    return null;
  const { query, variables, operationName } = body;
  if (
    variables !== undefined &&
    variables !== null &&
    (typeof variables !== "object" || Array.isArray(variables))
  )
    return null;
  if (
    operationName !== undefined &&
    operationName !== null &&
    typeof operationName !== "string"
  )
    return null;
  return {
    query,
    ...(variables
      ? { variables: variables as RemoteRequest["variables"] }
      : {}),
    ...(typeof operationName === "string" ? { operationName } : {}),
  };
}

export function createBackendRoutes(options: {
  database: SqlDatabase;
  host?: BackendHost;
  caller(
    client: SqlClient,
    pageId: FileId,
    credential: string,
  ): Promise<PageCaller>;
  secrets?: SecretsEnvPort;
  datasets?: import("../datasets/contracts.ts").DatasetReadService;
  datasetMutations?: import("../datasets/mutation/contracts.ts").DatasetMutationService;
  log?(line: string): void;
}): AfRouteModule {
  const { database, host, caller, secrets } = options;
  const NO_ENV: BackendEnv = Object.freeze({});
  const log = options.log ?? ((line: string) => console.error(line));
  const store = createBackendStore(database);
  /** Recompiles in flight, by "<file> <version>", so callers arriving together share one. */
  const upgrades = new Map<string, Promise<CompiledBackend>>();

  /**
   * The deployment to run for a link. One stored for an older runtime
   * generation is recompiled from its source against the current executor and
   * stored under the same version. Throws
   * FieldNotExecuted: nothing ran.
   */
  async function runnable(
    backendHost: BackendHost,
    pageId: FileId,
    link: CurrentLink,
  ): Promise<CompiledBackend> {
    if (isCurrentRuntime(link.deployment.runtime)) return link.deployment;
    const key = `${link.id} ${link.version}`;
    let upgrade = upgrades.get(key);
    if (!upgrade) {
      upgrade = (async () => {
        // No caller's signal: the recompile serves everyone waiting on it.
        const fresh = await backendHost.compile(link.deployment.source);
        // The page's schema was composed from the stored typeDefs; they must not move.
        if (
          fresh.typeDefs !== link.typeDefs ||
          JSON.stringify(fresh.fields) !==
            JSON.stringify(link.deployment.fields)
        )
          throw new BackendHostError("schema_rejected");
        await database.transaction((client) =>
          client.query(
            `UPDATE af_backend_versions SET deployment = $3::jsonb
              WHERE file_id = $1 AND version = $2`,
            [link.id, link.version, JSON.stringify(fresh)],
          ),
        );
        log(
          `backend runtime upgraded page=${pageId} backend=${link.id} version=${link.version}`,
        );
        return fresh;
      })().finally(() => upgrades.delete(key));
      upgrades.set(key, upgrade);
    }
    try {
      return await upgrade;
    } catch (error) {
      // Transient host trouble keeps its own code; anything else means this
      // source no longer builds into the same backend on the current runtime.
      const code =
        error instanceof BackendHostError && TRANSIENT.has(error.code)
          ? error.code
          : "recompile_failed";
      throw new FieldNotExecuted(code, code);
    }
  }

  async function list(request: AfRouteRequest, pageId: FileId) {
    return database.transaction(async (client) => {
      const who = await caller(client, pageId, request.credential);
      if (!who.role) return NOT_FOUND;
      const links = await currentLinks(client, pageId);
      return reply(200, listing(links));
    });
  }

  async function graphql(request: AfRouteRequest, pageId: FileId) {
    const remote = remoteRequest(request.body);
    if (!remote)
      return reply(400, { error: "A GraphQL request needs a query string" });
    // Read everything in one short transaction; never hold it open while backends run.
    const loaded = await database.transaction(async (client) => {
      const who = await caller(client, pageId, request.credential);
      if (!who.role) return null;
      const links = await currentLinks(client, pageId);
      // Each linked file's OWNER's secrets, read fresh for this request: never the page's or the caller's.
      const envs = new Map<string, BackendEnv>();
      for (const { owner } of links)
        if (!envs.has(owner))
          envs.set(owner, secrets ? await secrets(client, owner) : NO_ENV);
      return { who, links, envs };
    });
    if (!loaded) return NOT_FOUND;
    const { who, links, envs } = loaded;
    const schema = composePageSchema(
      links.map(({ name, id, version, typeDefs }) => ({
        name,
        fileId: id,
        version,
        typeDefs,
      })),
    );
    const linked = new Map(links.map((link) => [link.name, link]));
    const invoke = async (call: FieldCall): Promise<AfJson> => {
      const link = linked.get(call.namespace);
      try {
        if (!host || !link)
          throw new FieldNotExecuted(
            "backend_unavailable",
            "backend_unavailable",
          );
        const deployment = await runnable(host, pageId, link);
        // caps.store reaches this file's own document.
        const storeCapabilities = store.handler(link.id);
        const capabilities = options.datasets
          ? datasetCapabilityHandler(
              options.datasets,
              {
                backendId: link.id,
                backendVersion: deployment.version,
                pageId,
                subject: call.principal.subject,
              },
              storeCapabilities,
              options.datasetMutations,
            )
          : storeCapabilities;
        try {
          return (await host.invoke({
            deployment: deployment,
            principal: {
              tenant: call.principal.tenant,
              subject: call.principal.subject,
            },
            input: { field: call.field, args: call.args },
            signal: call.signal,
            capabilityHandler: capabilities,
            env: envs.get(link.owner) ?? NO_ENV,
            reuse: {
              kind: "file",
              scope: { owner: link.owner, fileId: link.id },
            },
          })) as AfJson;
        } catch (error) {
          if (!(error instanceof BackendHostError))
            throw new FieldFailed("internal");
          // The detail (what the backend said) reaches the page owner only; af-namespaces decides.
          if (NOT_STARTED.has(error.code))
            throw new FieldNotExecuted(error.code, error.code, error.detail);
          throw new FieldFailed(error.code, error.detail);
        }
      } catch (error) {
        const code = (error as FieldFailed | FieldNotExecuted).code;
        log(
          `backend call failed page=${pageId} backend=${link?.id ?? "-"} field=${call.field} code=${code}`,
        );
        throw error;
      }
    };
    const response = await executePageOperation({
      schema,
      request: remote,
      caller: who,
      invoke,
      signal: request.signal,
    });
    return reply(200, response);
  }

  return {
    async handle(request) {
      const match = ROUTE.exec(request.url.pathname);
      if (!match) return null;
      const pageId = match[1]!;
      const action = match[2]!;
      const method = action === "backends" ? "GET" : "POST";
      if (request.method !== method)
        return reply(405, { error: `Use ${method} for this route` });
      if (action === "backends") return list(request, pageId);
      return graphql(request, pageId);
    },
  };
}
