// @ts-check
import { readFileSync } from "node:fs";
import { hash } from "./server/text.ts";
import { fail } from "./errors.ts";
export {
  browserCookie,
  requestOrigin,
  sameOrigin,
  cookieToken,
  setBrowserCookie,
} from "./server/browser-session.ts";
import {
  sameOrigin,
  cookieToken,
  setBrowserCookie,
} from "./server/browser-session.ts";
/** The backend ID the skill's todo example links; the server replaces it with a reserved one. */
export const EXAMPLE_BACKEND_ID = "Td4sK9";
/** The home page's "try an example" publishes the skill's own example. */
export const example = () =>
  readFileSync(
    new URL("../skills/pagegi-author/examples/todo.html", import.meta.url),
    "utf8",
  );
/** The example's backend file, published with it. */
export const exampleBackend = () =>
  readFileSync(
    new URL(
      "../skills/pagegi-author/examples/backends/todos.ts",
      import.meta.url,
    ),
    "utf8",
  );
/**
 * The signed-in home page's API (cookie session, same-origin only) and the
 * hosted runner's representations of a page.
 * @param {{catalog: Pick<import('./persistence/document-catalog-contracts.ts').DocumentCatalog,'library'|'discover'>,
 * paths:import('./persistence/path-catalog-contracts.ts').PathCatalog,
 * accounts: ReturnType<typeof import('./server/account-service.ts').createAccountService>,
 * pages: import('./server/af-pages.ts').PageService,
 * example(actor:string, requestId:unknown): Promise<{source:string, files?:Record<string,string>}>,
 * download(credential:string, id:string, res:import('node:http').ServerResponse, origin:string): Promise<void>}} options
 */
export function libraryHandler({
  catalog,
  paths,
  accounts,
  pages,
  example: exampleFiles,
  download,
}) {
  /**
   * @param {import('./server/browser-session.ts').BrowserRequest} req
   * @param {import('node:http').ServerResponse} res
   * @param {URL} url
   * @param {any} input
   * @param {string} origin
   */
  return async (req, res, url, input, origin) => {
    const representation = /^\/api\/library\/([^/]+)\/(host|source)$/.exec(
      url.pathname,
    );
    if (!representation) {
      if (req.headers["x-pagegi-home"] !== "1")
        fail(403, "Open your library in Pagegi.");
      if (req.method !== "GET") sameOrigin(req);
    }
    res.setHeader("Cache-Control", "private, no-store");
    const credential =
      (req.headers.authorization || "").replace(/^Bearer(?: |$)/, "") ||
      cookieToken(req);
    /** @type {string | null} */
    let actor = null;
    try {
      actor = await accounts.actor(hash(credential));
    } catch (error) {
      if (
        !representation ||
        !(error instanceof Error && "status" in error && error.status === 401)
      )
        throw error;
    }
    /** @param {number} status @param {unknown} value */
    const send = (status, value) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(value));
    };
    if (
      url.pathname === "/api/library/profile" &&
      ["GET", "POST"].includes(req.method || "")
    ) {
      if (!actor) fail(401, "Sign in required");
      return send(
        200,
        await accounts.profile(
          actor,
          req.method === "POST"
            ? /** @type {{name?:string,image?:string|null}} */ (input)
            : undefined,
        ),
      );
    }
    if (url.pathname === "/api/library/logout" && req.method === "POST") {
      await accounts.revoke(hash(credential));
      setBrowserCookie(req, res, "");
      return send(200, { signedOut: true });
    }
    if (url.pathname === "/api/library/session" && req.method === "GET")
      return send(200, { username: actor });
    if (url.pathname === "/api/library" && req.method === "GET") {
      if (!actor) fail(401, "Sign in required");
      return send(200, {
        username: actor,
        files: await catalog.library(actor),
        sharedFiles: await catalog.discover(actor),
        folders: (await paths.paths(actor))
          .filter((e) => !e.fileId)
          .map((e) => e.path),
      });
    }
    if (url.pathname === "/api/library/paths" && req.method === "POST") {
      if (!actor) fail(401, "Sign in required");
      return send(200, { entries: await paths.changePath(actor, input) });
    }
    if (
      (url.pathname === "/api/library" ||
        url.pathname === "/api/library/example") &&
      req.method === "POST"
    ) {
      const sample = url.pathname.endsWith("/example");
      if (sample && !actor) fail(401, "Sign in required");
      const files = sample
        ? await exampleFiles(/** @type {string} */ (actor), input.requestId)
        : { source: input.html ?? input.source };
      const result = await pages.publish(
        credential,
        {
          ...files,
          requestId: input.requestId,
          path: input.path,
          visibility: input.visibility,
          linkRole: input.linkRole,
        },
        origin,
        undefined,
        // "New example" inside a folder: named from its title there, like in the root.
        sample ? { folder: input.folder } : {},
      );
      return send(result.status, result.value);
    }
    const downloadRoute = /^\/api\/library\/([^/]+)\/download$/.exec(
      url.pathname,
    );
    if (downloadRoute && req.method === "GET")
      return download(credential, downloadRoute[1] || "", res, origin);
    if (!representation || req.method !== "GET") fail(404, "Not found");
    const id = representation[1] || "";
    const page = await pages.host(
      credential,
      id,
      origin,
      representation[2] === "host",
    );
    res.setHeader("ETag", `"${page.version}"`);
    if (representation[2] === "source") {
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
      return res.end(page.source);
    }
    return send(200, page);
  };
}
