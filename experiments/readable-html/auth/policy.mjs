import { createHash, randomBytes } from "node:crypto";
/** @param {string} value */
export const challengeFor = (value) =>
  createHash("sha256").update(value).digest("hex");
const token = () => randomBytes(32).toString("hex");
/** @param {()=>number} [now] @returns {import("./contracts.ts").AuthPolicy} */
export function createPolicy(now = Date.now) {
  const grants = new Map(
      /** @type {[string, import("./contracts.ts").Grant][]} */ ([]),
    ),
    sessions = new Map(
      /** @type {[string, import("./contracts.ts").Session][]} */ ([]),
    );
  let generation = 0;
  return {
    issue(account, request) {
      if (
        account !== "fixture-account" ||
        !["a", "b"].includes(request.documentId) ||
        !/^[a-z0-9]{32,64}$/.test(request.channel) ||
        !/^[a-f0-9]{64}$/.test(request.challenge)
      )
        throw Error("denied");
      const g = {
        code: token(),
        request: { ...request },
        expiresAt: now() + 60000,
        generation,
      };
      grants.set(g.code, g);
      return g;
    },
    redeem(r) {
      const g = grants.get(r.code);
      if (
        !g ||
        g.expiresAt <= now() ||
        g.generation !== generation ||
        g.request.documentId !== r.documentId ||
        g.request.channel !== r.channel ||
        g.request.challenge !== r.challenge ||
        challengeFor(r.verifier) !== g.request.challenge
      )
        throw Error("denied");
      grants.delete(r.code);
      const s = {
        token: token(),
        documentId: r.documentId,
        expiresAt: now() + 300000,
        generation,
      };
      sessions.set(s.token, s);
      return s;
    },
    authorize(token, documentId) {
      const s = token ? sessions.get(token) : undefined;
      return (
        !!s &&
        s.documentId === documentId &&
        s.expiresAt > now() &&
        s.generation === generation
      );
    },
    revoke() {
      generation++;
      grants.clear();
      sessions.clear();
    },
  };
}
/** @param {string} host @param {string} path @param {boolean} authorized */
export function route(host, path, authorized) {
  if (host !== "platform.test" && !/^doc-[ab]\.content\.test$/.test(host))
    return { status: 421 };
  const api = /^\/docs\/([ab])\/(source|raw|history|shell)$/.exec(path);
  if (api)
    return { status: host !== "platform.test" ? 404 : authorized ? 200 : 403 };
  const app = /^\/app\/([ab])$/.exec(path);
  if (app)
    return {
      status:
        host !== `doc-${app[1]}.content.test` ? 404 : authorized ? 200 : 403,
    };
  return { status: 404 };
}
/** UI ownership is vendor-independent, explicitly distinct from authorization.
 * @param {{source:unknown,origin:string,data:unknown}} event
 * @param {unknown} parent
 * @param {string} channel
 * @returns {import('./contracts.ts').ChromeOwner | null}
 */
export function acceptChromeOffer(event, parent, channel) {
  const x = /** @type {Partial<import('./contracts.ts').ChromeOffer>|null} */ (
    event.data
  );
  if (
    event.source !== parent ||
    !x ||
    x.type !== "chrome-offer" ||
    x.version !== 1 ||
    x.channel !== channel ||
    typeof x.topbar !== "boolean" ||
    typeof x.modals !== "boolean"
  )
    return null;
  return {
    origin: event.origin,
    offer: /** @type {import('./contracts.ts').ChromeOffer} */ (x),
  };
}
/** @param {unknown} parent @param {string} channel @param {number} deadline */
export function createChromeNegotiation(parent, channel, deadline) {
  /** @type {import('./contracts.ts').ChromeOwner|null} */ let owner = null;
  return {
    /** @param {{source:unknown,origin:string,data:unknown}} event @param {number} now */
    receive(event, now) {
      if (owner || now >= deadline) return null;
      owner = acceptChromeOffer(event, parent, channel);
      return owner;
    },
    /** @param {number} now @returns {'parent'|'local'|'waiting'} */
    mode(now) {
      return owner ? "parent" : now >= deadline ? "local" : "waiting";
    },
  };
}
