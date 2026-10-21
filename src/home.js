// @ts-check
import { mountLogin } from "./library-client/login-view.js";
import { mountFiles } from "./library-client/files-view.js";
import { createLibraryViewState } from "./library-client/view-state.ts";
import { createLibrarySession } from "./library-client/session.ts";
import { createLibraryTransport } from "./library-client/transport.ts";
import { mountAccount } from "./library-client/account-view.js";
import { openSharing, renderSharing } from "./browser/sharing.js";
import { homeScreen, loginDestination } from "./navigation.js";
import { agentHandoff } from "./library-client/agent-handoff.ts";
const params = new URLSearchParams(location.search);
const embedded = params.has("embed") && window.parent !== window;
const sharingId = params.get("sharing");

const parentOrigin = document.referrer
  ? new URL(document.referrer).origin
  : "*";
/** @param {"close" | "ready" | "profile-changed"} event */
const frameEvent = (event) => {
  if (embedded)
    parent.postMessage(
      { type: sharingId ? "pagegi-sharing" : "pagegi-account", event },
      parentOrigin,
    );
};
if (embedded) {
  document.documentElement.classList.add("pg-embedded");
  addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      frameEvent("close");
    }
  });
}
/** @param {string} id */
const $ = (id) => {
  const element = document.getElementById(id);
  if (!element) throw Error("Missing library element: " + id);
  return element;
};
const status = $("status");
const loginElement = $("login");
if (!(loginElement instanceof HTMLDialogElement))
  throw Error("Missing login dialog");
const dialog = loginElement;
const view = createLibraryViewState({ changed: () => showScreen() });
const session = createLibrarySession({
  embedded,
  // The server marks a home page requested without the account cookie.
  signedOut:
    !embedded &&
    document.querySelector('meta[name="pagegi-session"]')?.getAttribute("content") === "none",
  sharing: Boolean(sharingId),
  changed() {
    view.invalidate();
  },
  request: createLibraryTransport((input, init) => fetch(input, init)),
});
const request = session.request;
addEventListener("pagehide", (event) => {
  if (!event.persisted) {
    view.invalidate();
    session.dispose();
  }
});
/** @param {string} value */
function message(value) {
  status.textContent = value;
}
function showScreen() {
  const sessionState = session.getSnapshot().status;
  const viewState = view.getSnapshot();
  const screen =
    viewState.error && sessionState === "signed-in"
      ? "error"
      : viewState.pending && sessionState === "signed-in"
        ? "loading"
        : homeScreen({
            session: sessionState,
            account: params.has("account") || Boolean(sharingId),
          });
  for (const [id, value] of [
    ["loading", "loading"],
    ["welcome", "welcome"],
    ["library", "library"],
    ["account-page", "account"],
    ["load-error", "error"],
  ])
    if (id) $(id).hidden = screen !== value;
  if (sessionState !== "signed-in") {
    $("sharing-page").hidden = true;
    $("sharing-page").replaceChildren();
  }
  const errorHeading = $("load-error").querySelector("h1");
  const errorDetail = $("load-error").querySelector("p");
  if (errorHeading)
    errorHeading.textContent = viewState.error
      ? "Couldn’t load this view"
      : "Couldn’t load Pagegi";
  if (errorDetail)
    errorDetail.textContent =
      viewState.error || "Your session could not be checked. Please try again.";
  $("sign-in").hidden = sessionState !== "signed-out";
  $("account-menu").hidden = sessionState !== "signed-in";
  $("footer").hidden = screen !== "welcome";
  $("page-crumb").textContent =
    screen === "account" ? "Account" : screen === "library" ? "Documents" : "";
  if (embedded && sessionState === "signed-out") {
    $("welcome").hidden = true;
    if (!dialog.open) loginView.open();
  }
  if (sharingId && sessionState === "signed-in")
    $("account-page").hidden = true;
  document.title =
    (screen === "account"
      ? "Account"
      : screen === "library"
        ? "Your documents"
        : "Pagegi") + " · Pagegi";
}
async function load() {
  const result = await session.load();
  if (!result) return;
  if (result.status !== "signed-in") {
    // A retry that works clears the old error.
    message(result.status === "failed" ? result.error : "");
    $("next-note").hidden = !(
      result.status === "signed-out" &&
      !embedded &&
      loginDestination(params.get("next"))
    );
    frameEvent("ready");
    return;
  }
  const { data, profile: accountProfile } = result;
  const next = loginDestination(
    new URLSearchParams(location.search).get("next"),
  );
  if (!embedded && next) {
    // A page address with #af-state= keeps its state through sign-in.
    location.replace(
      next + (/(?:^#|&)af-state=/.test(location.hash) ? location.hash : ""),
    );
    return;
  }
  const rendered = await view.render(async (current) => {
    accountView.update(accountProfile, data.username);
    filesView.update(data);
    message("");
    if (sharingId) {
      // A detached host keeps old async sharing work out of a newer account view.
      const staging = document.createElement("section");
      await renderSharing(staging, sharingId, { token: session.token });
      if (!current()) return;
      $("sharing-page").replaceChildren(...staging.childNodes);
      $("sharing-page").hidden = false;
    }
  });
  if (rendered) frameEvent("ready");
}
$("retry").onclick = load;
// Signed out, the welcome hands the same instructions to the person's coding
// agent; the agent asks for the email address when it signs in.
const welcomeCopy = "Copy agent instructions";
/** @type {HTMLTextAreaElement} */ ($("welcome-agent-text")).value = agentHandoff(location.origin);
$("welcome-agent-copy").onclick = async () => {
  try {
    if (!navigator.clipboard?.writeText) throw Error("No clipboard");
    await navigator.clipboard.writeText(
      /** @type {HTMLTextAreaElement} */ ($("welcome-agent-text")).value,
    );
    $("welcome-agent-copy").textContent = "Copied — paste into your agent";
    $("welcome-agent-status").textContent = "";
  } catch {
    $("welcome-agent-copy").textContent = welcomeCopy;
    $("welcome-agent-status").textContent =
      "Could not copy. Select and copy the text above.";
  }
};
async function signOut() {
  try {
    if (!(await session.logout())) return;
    accountView.close();
    if (!embedded) history.replaceState(null, "", "/");
    frameEvent("profile-changed");
    await load();
    frameEvent("close");
  } catch (e) {
    message(e instanceof Error ? e.message : String(e));
  }
}
$("sign-out").onclick = signOut;
$("menu-sign-out").onclick = signOut;
const loginView = mountLogin({
  $,
  request,
  session: {
    async verify(email, code) {
      view.invalidate();
      return session.verify(email, code);
    },
    cancelAuthentication: session.cancelAuthentication,
  },
  load,
  frameEvent,
});
const accountView = mountAccount({
  $,
  request,
  load,
  frameEvent,
  embedded,
  parentOrigin,
});
const filesView = mountFiles({
  $,
  request,
  reload: load,
  message,
  openSharing,
  folder: params.get("folder") || "/",
});
load().then(() => {
  if (!embedded)
    /** @type {Promise<{files?: import("./library-client/contracts.ts").LibraryFile[]}>} */
    (request("/api/public"))
      .then((data) => {
        filesView.renderDiscovered($("public-files"), data.files || []);
        $("public-documents").hidden = !data.files?.length;
      })
      .catch(() => {});
});
