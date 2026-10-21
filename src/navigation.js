/** @param {import('./contracts.ts').HomeNavigation} state
 * @returns {import('./contracts.ts').HomeScreen} */
export function homeScreen(state) {
  if (state.session === "pending") return "loading";
  if (state.session === "failed") return "error";
  if (state.session === "signed-out") return "welcome";
  return state.account ? "account" : "library";
}

/** A page address path: the same grammar as parseAddressPath in src/ids/file-id.ts
 * (this file is served to the browser as is, so it cannot import that module).
 * @param {string} path */
function pageAddressPath(path) {
  if (/^\/af\/v1\/ids\/[A-Za-z0-9]{6}$/.test(path)) return true;
  if (/^\/a\/[A-Za-z0-9]{6}(?:-[^/]*)?$/.test(path)) return true;
  if (!path.startsWith("/@")) return false;
  const segments = path.slice(2).split("/");
  if (segments.length < 2) return false;
  try {
    return segments.every((segment) => {
      const decoded = decodeURIComponent(segment);
      return !!decoded && decoded !== "." && decoded !== ".." && !decoded.includes("/");
    });
  } catch {
    return false;
  }
}

/** Retain only a page address on this server (/a/<ID>, /@<handle>/<path> or /af/v1/ids/<ID>) or a
 * downloaded file's connection approval (/connect?code=…), without URL normalization that could disguise traversal or alternate authorities. Queries stay on that route.
 * @param {string | null} value
 * @returns {import('./contracts.ts').LoginDestination | null} */
export function loginDestination(value) {
  if (!value || /[\\#\u0000-\u0020\u007f]/.test(value)) return null;
  const [path, query = ""] = value.split("?", 2);
  if (pageAddressPath(path))
    return /** @type {import('./contracts.ts').LoginDestination} */ (value);
  if (path === "/connect" && /^code=[A-Za-z0-9_-]{1,200}$/.test(query))
    return /** @type {import('./contracts.ts').LoginDestination} */ (value);
  return null;
}

/** @type {import('./contracts.ts').RunnerURLParser} */
export function runnerURL(value, base) {
  const url = new URL(value, base);
  if (url.protocol !== "https:" && url.protocol !== "http:")
    throw Error("Invalid runner URL protocol");
  return url;
}
