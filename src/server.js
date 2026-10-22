import { createDatasetRuntime } from "./server/dataset-runtime.ts";
import { createDatasetInvalidationReader } from "./persistence/dataset-invalidations.ts";
import { createBackendStoreInvalidationReader } from "./persistence/backend-store-invalidations.ts";
import { createLiveInvalidationConsumer } from "./live-invalidation.ts";
import { createTrashService } from "./trash/service.ts";
// @ts-check
import { parseRequestBody, parseFileRoute } from "./server/request.ts";
import { createPlatformAssets } from "./server/assets.ts";
import { createCollaborationService } from "./server/collaboration.ts";
import { createIdentityAuthority } from "./server/identity.ts";
import { createAuthenticationService } from "./server/authentication.ts";
import { createIdReservationStore } from "./server/af-ids.ts";
import { idempotencyKey } from "./server/idempotency.ts";
import { createPageService } from "./server/af-pages.ts";
import { createConnectService } from "./server/af-connect.ts";
import { createCommentService } from "./server/af-comments.ts";
import { createPageCaller } from "./server/af-caller.ts";
import {
  afAsset,
  attachment,
  portablePage,
} from "./server/af-hosting.ts";
import {
  backendFilesModule,
  pageModelModule,
} from "./server/page-ports.ts";
import { hash, documentTitle } from "./server/text.ts";
import { fileAddress, parseAddressPath } from "./ids/file-id.ts";
import { emailAddress } from "./email.ts";
import { AF_IDS_PATH, AF_PATH_PREFIX, DEFAULT_AF_ORIGIN, INSTALL_SCRIPT_PATH } from "./af-contracts.ts";
import { installScript } from "./server/install-script.ts";
import { hostedRequest } from "./hosted-policy.ts";
import {
  createHostedRunners,
  hostedShell,
  hostedStartupScriptPolicy,
  serveRunner,
} from "./hosted.js";
import {
  libraryHandler,
  cookieToken,
  setBrowserCookie,
  sameOrigin,
  example,
  exampleBackend,
  EXAMPLE_BACKEND_ID,
} from "./library.js";
import { createServer } from "node:http";
import { randomBytes as cryptoRandomBytes } from "node:crypto";
import { liveHub } from "./live.js";
import { database } from "./database.js";
import { createAccountService } from "./server/account-service.ts";
import {
  createSecretCipher,
  createSecretsRoutes,
  createSecretsStore,
} from "./server/secrets.ts";
import { createHandleRoutes, handleStore } from "./server/handles.ts";
import { fail } from "./model.ts";
import { mediaRepository } from "./persistence/media.ts";
import { readOnlyMediaStore } from "./media/filestore.ts";
import { createMediaService } from "./media/service.ts";
import { serveMedia } from "./media/http.ts";
const token = () => cryptoRandomBytes(32).toString("base64url");
/** @param {Parameters<typeof database>[0]} options @param {string} username @param {string} password */
export async function addAccount(options, username, password) {
  const store = database(options);
  try {
    await createAccountService({
      repository: store.identity,
      authority: createIdentityAuthority(),
    }).add(username, password);
  } finally {
    await store.close();
  }
}
/**
 * The Pagegi server (AfServerModule in src/server/af-api-contracts.ts).
 * @param {import("./server/af-api-contracts.ts").AfServiceOptions & {allowPasswordLogin?:boolean}} options
 */
export function createService({
  connectionString,
  schema,
  now = Date.now,
  sendCode,
  allowPasswordLogin = true,
  platformOrigin,
  runnerOrigin,
  backendHost,
  secretsKey,
  mediaDirectory,
  datasetDirectory,
  datasetMutationDirectory,
  datasetSqlExecutor,
  testLogin = false,
  knownOrigins = [DEFAULT_AF_ORIGIN],
  randomBytes = (count) => new Uint8Array(cryptoRandomBytes(count)),
} = {}) {
  if (testLogin && process.env.NODE_ENV === "production")
    throw Error("Test login is for development and tests; it cannot run in production");
  const hostedConfig = { platformOrigin, runnerOrigin };
  const runners = createHostedRunners(hostedConfig);
  const repository = database({ connectionString, schema, now }),
    presence = new Map();
  const authority = createIdentityAuthority({ now });
  const accounts = createAccountService({
    repository: repository.identity,
    authority,
  });
  /** @param {{headers: import("node:http").IncomingHttpHeaders}} req */
  const credential = (req) =>
    // An empty bearer header ("Bearer", once trimmed) is no credential.
    (req.headers.authorization || "").replace(/^Bearer(?: |$)/, "");
  const authentication = createAuthenticationService({
    repository: repository.identity,
    authority,
    now,
    sendCode,
    allowPasswordLogin,
  });
  const collaboration = createCollaborationService({
    repository: repository.collaboration,
    authority,
    presence,
    now,
  });
  /** @type {import("./backend/af-backend-contracts.ts").BackendFilesPort | undefined} */
  let backendPort;
  const trash = createTrashService(repository.sql, authority.account);
  const pages = createPageService({
    database: repository.sql,
    authority,
    pageModel: () => pageModelModule.required(),
    backendFiles: async () => {
      const module = await backendFilesModule.optional();
      return module
        ? (backendPort ||= module.createBackendFiles({ host: backendHost }))
        : null;
    },
    randomBytes,
    knownOrigins,
    now,
    token,
  });
  const comments = createCommentService({ comments: repository.comments, now });
  /** Downloaded files connecting to their pages (src/server/af-connect-contracts.ts). */
  const connect = createConnectService({ pages, now });
  /** Account secrets, which lambdas read as `env`; undefined without PAGEGI_SECRETS_KEY (routes 503, env {}). */
  const secretsStore = secretsKey
    ? createSecretsStore({ cipher: createSecretCipher(secretsKey), now })
    : undefined;
  const secrets = createSecretsRoutes({
    database: repository.sql,
    actor: (credential) => accounts.actor(hash(credential)),
    store: secretsStore,
  });
  /** Account handles, the public name in /@<handle>/<path> (src/server/handles-contracts.ts). */
  const handles = createHandleRoutes({
    database: repository.sql,
    actor: (credential) => accounts.actor(hash(credential)),
  });
  const ids = createIdReservationStore(repository.sql, { randomBytes, now });
  /** @type {Promise<import("./server/af-api-contracts.ts").AfRouteModule | null> | undefined} */
  let backendRoutes;
  const datasetRuntime = createDatasetRuntime({
    database: repository.sql,
    sourceDirectory: datasetDirectory,
    mutationDirectory: datasetMutationDirectory,
    executor: datasetSqlExecutor,
    now,
  });
  const backendRouteModule = () =>
    (backendRoutes ||= backendFilesModule.optional().then((module) =>
      module
        ? module.createBackendRoutes({
            database: repository.sql,
            host: backendHost,
            caller: createPageCaller(now),
            datasets: datasetRuntime.reads,
            datasetMutations: datasetRuntime.mutations,
            datasetMembers: datasetRuntime.members,
            datasetPerson: datasetRuntime.person,
            secrets: secretsStore && ((client, owner) => secretsStore.env(client, owner)),
          })
        : null,
    ));
  const assets = createPlatformAssets();
  const media = createMediaService(mediaRepository(repository.sql, now), readOnlyMediaStore(mediaDirectory));
  const server = createServer(async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Authorization,Content-Type,If-Match,Idempotency-Key",
    );
    res.setHeader("Access-Control-Expose-Headers", "ETag");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    /** @param {number} status @param {unknown} value */
    const send = (status, value) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(value));
    };
    try {
      const boundary = hostedRequest(
        req.headers.host || "",
        listeningPort(),
        hostedConfig,
      );
      if (boundary.kind === "runner")
        return serveRunner(req, res, platformOrigin, boundary.origin);
      Object.assign(req, { pagegiOrigin: boundary.origin });
      const url = new URL(req.url || "/", boundary.origin);
      if (await serveMedia(req, res, url, media, credential(req) || cookieToken(req))) return;
      if (req.method === "OPTIONS") {
        res.writeHead(204);
        return res.end();
      }
      /** The server's public origin: written into saved pages and addresses. */
      const origin = platformOrigin || boundary.origin;
      const asset = assets.resolve(req.method || "GET", url, {
        signedIn: !!cookieToken(req),
      });
      if (asset) {
        res.writeHead(200, asset.headers);
        return res.end(asset.body);
      }
      // A page's address: /a/<id>, /a/<id>-<title> or /@<handle>/<path>.
      const pageAddress = parseAddressPath(url.pathname);
      if (pageAddress) {
        if (req.method !== "GET") fail(404, "Not found");
        const id =
          pageAddress.kind === "id"
            ? pageAddress.id
            : await libraryPathId(pageAddress.handle, pageAddress.path);
        return await address(req, res, url, origin, id);
      }
      if (url.pathname.startsWith(AF_PATH_PREFIX)) {
        if (req.method !== "GET") fail(404, "Not found");
        if (url.pathname.startsWith(AF_IDS_PATH))
          return await address(
            req,
            res,
            url,
            origin,
            url.pathname.slice(AF_IDS_PATH.length),
          );
        const file = await afAsset(url.pathname);
        if (!file) fail(404, "Not found");
        res.writeHead(200, file.headers);
        return res.end(file.body);
      }
      if (url.pathname === "/health" && req.method === "GET") {
        await repository.health();
        return send(200, { ok: true });
      }
      if (url.pathname === INSTALL_SCRIPT_PATH && req.method === "GET") {
        res.writeHead(200, { "Content-Type": "text/x-shellscript; charset=utf-8", "Cache-Control": "public, max-age=300" });
        return res.end(installScript(origin));
      }
      // The welcome page's "Try a local example": the todo example as a file that works on its own.
      if (
        url.pathname === "/example.html" &&
        (req.method === "GET" || req.method === "HEAD")
      )
        // Not a published page, so it names no server to reconnect to.
        return sendDownload(res, { id: "example", version: 0, revision: "", path: "pagegi-example.html", source: example(), state: null });
      if (url.pathname === "/api/public" && req.method === "GET")
        return send(200, {
          files: await repository.catalog.discover(null, true),
        });
      let raw = "";
      for await (const chunk of req) {
        raw += chunk;
        if (raw.length > 8e6) fail(413, "Request too large");
      }
      // Command services validate their own fields after transport shape checking.
      const input = /** @type {any} */ (parseRequestBody(raw));
      const controller = new AbortController();
      res.once("close", () => {
        if (!res.writableEnded) controller.abort();
      });
      if (url.pathname === "/api/auth/test-token" && req.method === "POST") {
        if (!testLogin) fail(404, "Not found");
        if (input.browserSession) sameOrigin(req);
        const email = emailAddress(input.email);
        /** @type {{token:string,username:string}} */
        const issued = await repository.identity.withEmailChallenge(
          email,
          ({ account }) => {
            const session = authority.issue(email);
            return {
              ...(account ? {} : { createAccount: {} }),
              issued: session,
              value: { token: session.credential, username: email },
            };
          },
        );
        if (input.browserSession) {
          setBrowserCookie(req, res, issued.token);
          return send(200, { username: issued.username });
        }
        return send(200, issued);
      }
      if (url.pathname === "/api/auth/session" && req.method === "GET") {
        // Whoami for a bearer token: 401 when it is missing, expired or revoked.
        const actor = await accounts.actor(hash(credential(req)));
        return send(200, {
          username: actor,
          handle: await repository.sql.transaction((client) => handleStore.read(client, actor)),
        });
      }
      // A downloaded file connecting to its page: begin and poll from its platform
      // frame; approve from the window on this origin, as the website session.
      if (url.pathname === "/api/pair/info" && req.method === "GET") {
        const { fileId } = connect.info(url.searchParams.get("code"));
        return send(200, { fileId, path: (await pages.connectInfo(fileId, cookieToken(req))).path });
      }
      if (req.method === "POST" && ["/api/pair", "/api/pair/approve", "/api/pair/poll"].includes(url.pathname)) {
        if (url.pathname === "/api/pair/approve") {
          sameOrigin(req);
          if (req.headers["x-pagegi-home"] !== "1") fail(403, "Approve connections in Pagegi.");
          const approved = await connect.approve(cookieToken(req), input.code);
          return send(approved.status, approved.value);
        }
        const result = url.pathname === "/api/pair" ? await connect.begin(input.fileId) : connect.poll(input.deviceCode);
        return send(result.status, result.value);
      }
      if (
        req.method === "POST" &&
        [
          "/api/login",
          "/api/auth/email/request",
          "/api/auth/email/verify",
        ].includes(url.pathname)
      ) {
        if (input.browserSession) sameOrigin(req);
        /** @type {import("./server/identity-contracts.ts").AuthenticationCommand} */
        const command =
          url.pathname === "/api/login"
            ? {
                kind: "password",
                username: input.username,
                password: input.password,
                peer: req.socket.remoteAddress || "",
              }
            : url.pathname.endsWith("/request")
              ? { kind: "request-code", email: input.email }
              : { kind: "verify-code", email: input.email, code: input.code };
        const result = await authentication.execute(command);
        if (
          input.browserSession &&
          result.value.token &&
          command.kind === "verify-code"
        ) {
          setBrowserCookie(req, res, result.value.token);
          return send(result.status, { username: result.value.username });
        }
        return send(result.status, result.value);
      }
      if (url.pathname === "/api/ids" && req.method === "POST") {
        const actor = await accounts.actor(hash(credential(req)));
        const key = req.headers["idempotency-key"];
        if (typeof key !== "string" || !key)
          fail(400, "Send an Idempotency-Key header");
        const result = await ids.reserve(actor, key, input.count);
        return send(result.replayed ? 200 : 201, { ids: result.ids });
      }
      if (url.pathname === "/api/publish" && req.method === "POST") {
        const result = await pages.publish(
          credential(req),
          input,
          origin,
          controller.signal,
        );
        return send(result.status, result.value);
      }
      if (
        url.pathname === "/api/paths" &&
        ["GET", "POST"].includes(req.method || "")
      )
        return send(
          200,
          await pages.paths(
            credential(req),
            origin,
            req.method === "POST" ? input : undefined,
            { ...(url.searchParams.has("owner") ? { owner: url.searchParams.get("owner") ?? "" } : {}) },
          ),
        );
      if (url.pathname === "/api/secrets" || url.pathname.startsWith("/api/secrets/") || url.pathname.startsWith("/api/account/")) {
        // The home page's cookie session counts only from the home page itself, same origin for writes.
        if (!credential(req) && req.headers["x-pagegi-home"] === "1") {
          if (req.method !== "GET") sameOrigin(req);
          req.headers.authorization = "Bearer " + cookieToken(req);
        }
        const route = { method: req.method || "GET", url, credential: credential(req), body: input, signal: controller.signal };
        const handled = await (url.pathname.startsWith("/api/account/") ? handles : secrets).handle(route);
        if (!handled) fail(404, "Not found");
        return send(handled.status, handled.body);
      }
      const sharingRoute = /^\/api\/library\/([^/]+)\/sharing$/.exec(
        url.pathname,
      );
      if (sharingRoute) {
        if (req.headers["x-pagegi-home"] !== "1")
          fail(403, "Open sharing in Pagegi.");
        if (req.method !== "GET") sameOrigin(req);
        req.headers.authorization ||= "Bearer " + cookieToken(req);
        url.pathname = "/api/files/" + sharingRoute[1] + "/sharing";
      }
      if (
        url.pathname === "/api/library" ||
        url.pathname.startsWith("/api/library/")
      )
        return await library(req, res, url, input, origin);
      if (url.pathname === "/api/trash" || url.pathname.startsWith("/api/trash/")) {
        if (!credential(req) && req.headers["x-pagegi-home"] === "1") {
          if (req.method !== "GET") sameOrigin(req);
          req.headers.authorization = "Bearer " + cookieToken(req);
        }
        const result = await trash.handle(credential(req), url, req.method || "GET", input, now());
        if (!result) fail(404, "Not found");
        if ("deletedIds" in result) for (const id of result.deletedIds) live.changed(id, true);
        return send(200, result);
      }
      const deleteRoute = /^\/api\/files\/([A-Za-z0-9]{6})$/.exec(url.pathname);
      if (deleteRoute && req.method === "DELETE") {
        if (!credential(req) && req.headers["x-pagegi-home"] === "1") {
          sameOrigin(req);
          req.headers.authorization = "Bearer " + cookieToken(req);
        }
        const removed = await pages.remove(credential(req), deleteRoute[1] || "");
        // Open views and sockets for the page lose access now.
        live.changed(removed.id, true);
        return send(200, removed);
      }
      const fileRoute = parseFileRoute(url.pathname);
      if (!fileRoute) fail(404, "Not found");
      const routeParts = fileRoute.parts;
      const id = fileRoute.fileId,
        route = routeParts[3],
        method = req.method;
      if (route === "backends" || route === "graphql") {
        const routes = await backendRouteModule();
        if (!routes) fail(503, "Backends are not available on this server");
        const handled = await routes.handle({
          method: method || "GET",
          url,
          credential: credential(req),
          body: input,
          signal: controller.signal,
        });
        if (!handled) fail(404, "Not found");
        return send(handled.status, handled.body);
      }
      if (route === "source" && method === "GET") {
        const current = await pages.readSource(credential(req), id);
        res.setHeader("ETag", `"${current.version}"`);
        return send(200, current);
      }
      if (route === "source" && method === "PUT") {
        const header = req.headers["if-match"];
        const saved = await pages.save(
          credential(req),
          id,
          Array.isArray(header) ? header[0] : header,
          input,
          origin,
          controller.signal,
          idempotencyKey(req.headers["idempotency-key"]),
        );
        res.setHeader("ETag", `"${saved.value.version}"`);
        if (saved.changed) live.changed(id, false);
        return send(saved.status, saved.value);
      }
      if (route === "comments" && routeParts.length === 4) {
        if (method === "GET")
          return send(
            200,
            await comments.list(id, credential(req), url.searchParams.get("since")),
          );
        if (method === "POST") {
          const created = await comments.add(
            id,
            credential(req),
            input,
            idempotencyKey(req.headers["idempotency-key"]),
          );
          live.changed(id, false);
          return send(201, created);
        }
      }
      if (route === "comments" && routeParts.length === 5 && method === "PUT") {
        const header = req.headers["if-match"];
        const edited = await comments.edit(
          id,
          credential(req),
          routeParts[4] || "",
          Array.isArray(header) ? header[0] : header,
          input,
        );
        live.changed(id, false);
        return send(200, edited);
      }
      if (route === "capture" && routeParts.length === 4 && method === "POST")
        return send(
          200,
          await comments.capture(
            id,
            credential(req),
            input?.sessionId,
            presence.get(id) || {},
          ),
        );
      if (route === "context" && routeParts.length === 5 && method === "GET")
        return send(
          200,
          await comments.context(id, credential(req), routeParts[4] || "", origin),
        );
      /** @type {import("./server/collaboration-contracts.ts").CollaborationCommand | null} */
      const command =
        route === "permissions" && method === "GET"
                  ? { kind: "permissions" }
                  : route === "sharing" && method === "GET"
                    ? { kind: "sharing" }
                    : route === "sharing" && method === "PUT"
                      ? {
                          kind: "change-sharing",
                          policy: input,
                          expectedVersion: Number(
                            String(req.headers["if-match"] ?? "").replace(
                              /^"|"$/g,
                              "",
                            ),
                          ),
                        }
                      : route === "profiles" && method === "GET"
                        ? { kind: "profiles" }
                        : route === "presence" && method === "GET"
                          ? { kind: "presence" }
                          : route === "presence" && method === "PUT"
                            ? { kind: "update-presence", input }
                            : route === "revoke" && method === "POST"
                              ? { kind: "revoke" }
                              : null;
      if (!command) fail(404, "Not found");
      const result = await collaboration.execute(id, credential(req), command);
      if (result.changed === "presence")
        live.presenceChanged(id, result.generation);
      else if (result.changed)
        live.changed(id, result.changed === "policy" ? "policy" : true);
      send(
        200,
        command.kind === "sharing" || command.kind === "change-sharing"
          ? {
              .../** @type {object} */ (result.value),
              url: fileAddress(origin, id),
            }
          : result.value,
      );
    } catch (caught) {
      const e = caught instanceof Error ? caught : new Error("Request failed");
      const errorStatus =
        "status" in e && typeof e.status === "number" ? e.status : undefined;
      if (!errorStatus) console.error(e);
      const details =
        errorStatus &&
        "details" in e &&
        e.details &&
        typeof e.details === "object"
          ? e.details
          : {};
      if (res.headersSent) return res.destroy();
      send(errorStatus || 500, {
        error: errorStatus ? e.message : "Request failed",
        ...details,
      });
    }
  });
  /**
   * The page at `path` in the library of the account with `handle`, or 404: an
   * unknown or freed handle (an email address is never one), a renamed or
   * missing path and a malformed one all look the same.
   * @param {string} handle @param {string} path
   */
  async function libraryPathId(handle, path) {
    const owner = await repository.sql.transaction((client) => handleStore.actor(client, handle));
    if (!owner) fail(404, "Not found");
    let id = null;
    try {
      id = await repository.catalog.resolvePath(owner, path);
    } catch (error) {
      if (!(error && typeof error === "object" && "status" in error && error.status === 422)) throw error;
    }
    return id ?? fail(404, "Not found");
  }
  /**
   * A file's address (GET /a/<id>, /@<handle>/<path> or /af/v1/ids/<id>): a
   * page opens in the hosted shell (its scripts run in the per-document runner
   * origin), ?download=1 is the portable file, and a backend file shows its
   * details to its owner. Anything else is 404.
   * @param {import("node:http").IncomingMessage} req
   * @param {import("node:http").ServerResponse} res
   * @param {URL} url
   * @param {string} origin
   * @param {string} id
   */
  async function address(req, res, url, origin, id) {
    const viewer = credential(req) || cookieToken(req);
    const download = url.searchParams.get("download") === "1";
    let found;
    try {
      found = await pages.address(viewer, id);
    } catch (error) {
      // A signed-out visitor is sent to sign in; nothing about the file is revealed.
      if (!download && error && typeof error === "object" && "signIn" in error && error.signIn) {
        res.writeHead(302, {
          Location: "/?next=" + encodeURIComponent(url.pathname + url.search),
        });
        return res.end();
      }
      throw error;
    }
    res.setHeader("Cache-Control", "private, no-store");
    if (found.kind === "backend") {
      if (download) fail(404, "Not found");
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify(found.value));
    }
    if (download) return sendDownload(res, found.page, origin);
    const runner = await runners.address(id, origin);
    const boot = {
      home: origin,
      fileId: id,
      version: found.page.version,
      runner,
      sourceUrl: `/api/library/${id}/source`,
      stateUrl: `/api/library/${id}/host`,
    };
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      Link: `</api/library/${id}/source>; rel="alternate"; type="text/plain"`,
      "Content-Security-Policy": `default-src 'self'; script-src 'self' ${hostedStartupScriptPolicy}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' ws: wss:; frame-src 'self' ${new URL(runner).origin}; frame-ancestors 'none'; base-uri 'none'; object-src 'none'`,
    });
    res.end(hostedShell({ title: documentTitle(found.page.source), boot }));
  }
  /**
   * @param {import("node:http").ServerResponse} res
   * @param {import("./server/af-pages.ts").AddressedPage} page
   * @param {string} [origin] The server to record in the file; none for a file that is not a published page.
   */
  async function sendDownload(res, page, origin) {
    const file = await portablePage(await pageModelModule.required(), page, origin);
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Disposition": attachment(file.filename),
      "Content-Security-Policy": "frame-ancestors 'none'; base-uri 'none'",
      "Cache-Control": "private, no-store",
    });
    res.end(file.html);
  }
  function listeningPort() {
    const address = server.address();
    if (!address || typeof address === "string")
      throw Error("TCP server is not listening");
    return address.port;
  }
  const library = libraryHandler({
    catalog: {
      library: repository.catalog.library,
      discover: repository.catalog.discover,
    },
    paths: repository.paths,
    accounts,
    pages,
    /**
     * The skill's todo example with its backend under an ID reserved for the
     * account (the same ID on a retry); a server without backends publishes
     * the page alone, which then shows its list as offline.
     * @param {string} actor @param {unknown} requestId
     */
    async example(actor, requestId) {
      const page = example();
      if (!backendHost)
        return {
          source: page.replace(/\n\s*<link rel="af-backend"[^>]*>/, ""),
        };
      const key = "example:" + String(requestId ?? "").slice(0, 180);
      const [backendId] = (await ids.reserve(actor, key, 1)).ids;
      return {
        source: page.replaceAll(EXAMPLE_BACKEND_ID, String(backendId)),
        files: { [String(backendId)]: exampleBackend() },
      };
    },
    async download(viewer, id, res, origin) {
      const found = await pages.address(viewer, id);
      if (found.kind !== "page") fail(404, "Not found");
      await sendDownload(res, found.page, origin);
    },
  });
  const live = liveHub({
    server,
    presence,
    now,
    /** @param {import("node:http").IncomingMessage} req */
    acceptUpgrade: (req) => {
      try {
        return (
          hostedRequest(req.headers.host || "", listeningPort(), hostedConfig)
            .kind === "platform"
        );
      } catch {
        return false;
      }
    },
    /** @param {string} id @param {string} token @param {string} revision */
    authorize: (id, token, revision) =>
      collaboration.authorizeLive(id, token, revision),
  });
  /** @type {import('./live-invalidation-contracts.ts').LiveInvalidationConsumer[]} */
  const invalidations = [];
  const startInvalidations = () => {
    for (const reader of [
      createDatasetInvalidationReader(repository.sql),
      createBackendStoreInvalidationReader(repository.sql),
    ])
      invalidations.push(
        createLiveInvalidationConsumer({
          reader,
          changed: (id) => live.changedAndWait(id),
        }),
      );
  };
  server.once("listening", startInvalidations);
  /** @type {Promise<void> | undefined} */
  let closing;
  return {
    server,
    close: () => {
      if (closing) return closing;
      // Start every disposal even if another throws; do not leave owned pools or
      // execution work alive when one cleanup fails.
      closing = Promise.allSettled(
        [
          () => live.close(),
          () => runners.close(),
          () => backendHost?.close?.(),
          () => {
            server.off("listening", startInvalidations);
            return Promise.all(
              invalidations.map((consumer) => consumer.close()),
            );
          },
          () => datasetRuntime.close(),
        ].map((dispose) => Promise.resolve().then(dispose)),
      ).then(async (results) => {
        const databaseCleanup = await Promise.allSettled([repository.close()]);
        const failed = [...results, ...databaseCleanup].find(
          (result) => result.status === "rejected",
        );
        if (failed?.status === "rejected") throw failed.reason;
      });
      return closing;
    },
  };
}
