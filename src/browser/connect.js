// @ts-check
// The approval window a downloaded file opens on its server (GET /connect?code=…).
// It runs on the platform origin with the website session, so this is where
// the viewer is identified; the file only ever learns the username.
const code = new URLSearchParams(location.search).get("code") || "";
const $ = (id) => /** @type {HTMLElement} */ (document.getElementById(id));
const status = $("status"),
  approve = /** @type {HTMLButtonElement} */ ($("approve")),
  signIn = /** @type {HTMLAnchorElement} */ ($("sign-in"));
/** @param {string} path @param {unknown} [body] */
async function request(path, body) {
  const response = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json", "X-Pagegi-Home": "1" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const value = await response.json().catch(() => ({}));
  if (!response.ok) throw Error(value.error || "Request failed");
  return value;
}
async function start() {
  if (!code) throw Error("Open Connect from your page to approve a connection.");
  const info = await request("/api/pair/info?code=" + encodeURIComponent(code));
  $("page").textContent = `Connect ${info.path ?? "page " + info.fileId} to this server.`;
  const session = await request("/api/library/session");
  if (session.username) {
    $("who").textContent = `Signed in as ${session.username}. Approving lets the open file comment and share presence on this page as you. It never sees your account.`;
    approve.hidden = false;
    approve.focus();
  } else {
    $("who").textContent = "Sign in to approve this connection.";
    signIn.href = "/?next=" + encodeURIComponent("/connect?code=" + code);
    signIn.hidden = false;
  }
}
approve.onclick = async () => {
  approve.disabled = true;
  try {
    await request("/api/pair/approve", { code });
    approve.remove();
    status.textContent = "Connected. Return to your page.";
    setTimeout(() => window.close(), 1500);
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : String(error);
    approve.disabled = false;
  }
};
start().catch((error) => {
  status.textContent = error instanceof Error ? error.message : String(error);
});
