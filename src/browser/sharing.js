/** @typedef {'viewer'|'commenter'|'editor'} ShareRole */
/** @typedef {{visibility:'public'|'unlisted'|'private',linkRole:ShareRole,shares:Record<string,ShareRole>,version:number}} SharingPolicy */
/** @typedef {{policy:SharingPolicy,permissions:{manage:boolean},url:string,owner:string}} SharingState */
const roles = {
  viewer: "can view",
  commenter: "can comment",
  editor: "can edit",
};
const element = (tag, text, className) => {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  if (className) node.className = className;
  return node;
};
function roleSelect(label, value) {
  const select = element("select");
  select.setAttribute("aria-label", label);
  for (const [role, text] of Object.entries(roles)) {
    const option = element("option", text);
    option.value = role;
    select.append(option);
  }
  select.value = value;
  return select;
}
/**
 * Render only in the authenticated, trusted home frame. The optional token stays
 * inside this frame and is read afresh for each same-origin request.
 * @param {HTMLElement} container
 * @param {string} fileId
 * @param {{token?:()=>string|undefined|null}} [options]
 */
export async function renderSharing(container, fileId, options = {}) {
  const root = element("section", "", "pg-sharing");
  root.setAttribute("aria-label", "Share");
  const heading = element("h2", "Share");
  const copy = element("button", "Copy link", "pg-sharing-copy");
  copy.type = "button";
  copy.disabled = true;
  const status = element("p", "Loading sharing…");
  status.setAttribute("role", "status");
  const error = element("p", "", "pg-sharing-error");
  error.setAttribute("role", "alert");
  const retry = element("button", "Try again");
  retry.type = "button";
  retry.hidden = true;
  const content = element("div");
  const notice = element(
    "p",
    "Access changes cannot revoke previously downloaded copies.",
    "pg-sharing-notice",
  );
  root.append(heading, copy, status, error, retry, content, notice);
  container.replaceChildren(root);
  const endpoint = `/api/library/${encodeURIComponent(fileId)}/sharing`;
  let state,
    busy = false;
  // Keep draft nodes alive while the authoritative policy refreshes after a conflict.
  const form = element("form", "", "pg-sharing-invite");
  const email = element("input");
  email.type = "email";
  email.required = true;
  email.placeholder = "email@example.com";
  email.setAttribute("aria-label", "Invite email");
  const inviteRole = roleSelect("Invite role", "viewer");
  const add = element("button", "Add");
  add.type = "submit";
  add.setAttribute("aria-label", "Add email");
  form.append(email, inviteRole, add);
  const request = (method, patch) => {
    const token = options.token?.();
    return fetch(endpoint, {
      method,
      credentials: "same-origin",
      signal: AbortSignal.timeout(15000),
      headers: {
        "X-Pagegi-Home": "1",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(method === "PUT"
          ? {
              "Content-Type": "application/json",
              "If-Match": String(state.policy.version),
            }
          : {}),
      },
      ...(patch ? { body: JSON.stringify(patch) } : {}),
    });
  };
  function draw() {
    content.replaceChildren();
    if (!state.permissions.manage) return;
    const controls = element("div", "", "pg-sharing-controls");
    const visibility = element("div", "", "pg-sharing-visibility");
    visibility.setAttribute("role", "group");
    visibility.setAttribute("aria-label", "Link visibility");
    for (const value of ["public", "unlisted", "private"]) {
      const button = element("button", value[0].toUpperCase() + value.slice(1));
      button.type = "button";
      button.setAttribute(
        "aria-pressed",
        String(state.policy.visibility === value),
      );
      button.onclick = () => put({ visibility: value });
      visibility.append(button);
    }
    controls.append(visibility);
    if (state.policy.visibility !== "private") {
      const row = element("label", "", "pg-sharing-row");
      row.append(element("span", "anyone with the link"));
      const select = roleSelect("Link role", state.policy.linkRole);
      select.onchange = () => put({ linkRole: select.value });
      row.append(select);
      controls.append(row);
    }
    const people = element("section", "", "pg-sharing-people");
    people.append(element("h3", "People"));
    const owner = element("div", "", "pg-sharing-row");
    owner.append(element("span", state.owner), element("span", "Owner"));
    people.append(owner);
    for (const [address, role] of Object.entries(state.policy.shares)) {
      const row = element("div", "", "pg-sharing-row");
      const name = element("span", address);
      name.className = "pg-sharing-email";
      const select = roleSelect(`Role for ${address}`, role);
      select.onchange = () => put({ email: address, role: select.value });
      const remove = element("button", "×");
      remove.type = "button";
      remove.setAttribute("aria-label", `Remove ${address}`);
      remove.onclick = () => put({ email: address, role: null });
      row.append(name, select, remove);
      people.append(row);
    }
    people.append(form);
    controls.append(people);
    content.append(controls);
    disable();
  }
  function disable() {
    for (const control of content.querySelectorAll("button,select,input"))
      control.disabled = busy;
  }
  async function load() {
    const response = await request("GET");
    if (!response.ok) throw Error("Could not load sharing.");
    state = await response.json();
    copy.disabled = false;
    status.textContent = "";
    draw();
  }
  async function put(patch) {
    if (busy || !state.permissions.manage) return false;
    busy = true;
    disable();
    error.textContent = "";
    try {
      const response = await request("PUT", patch);
      if (response.status === 412) {
        error.textContent =
          "Sharing changed elsewhere. Review the latest settings and try again.";
        await load();
        return false;
      }
      if (!response.ok) throw Error("Could not update sharing. Try again.");
      state = await response.json();
      draw();
      return true;
    } catch (failure) {
      error.textContent = failure.message;
      return false;
    } finally {
      busy = false;
      disable();
    }
  }
  form.onsubmit = async (event) => {
    event.preventDefault();
    const address = email.value.trim();
    if (!address) return;
    if (await put({ email: address, role: inviteRole.value })) email.value = "";
  };
  copy.onclick = async () => {
    try {
      const url = new URL(state.url, location.origin);
      if (
        url.origin !== location.origin ||
        !["http:", "https:"].includes(url.protocol) ||
        url.username ||
        url.password
      )
        throw Error("Invalid sharing link.");
      await navigator.clipboard.writeText(url.href);
      status.textContent = "Link copied";
    } catch {
      error.textContent = "Could not copy link. Try again.";
    }
  };
  async function loadView() {
    retry.hidden = true;
    error.textContent = "";
    status.textContent = "Loading sharing…";
    try {
      await load();
    } catch (failure) {
      status.textContent = "";
      error.textContent = failure.message;
      retry.hidden = false;
    }
  }
  retry.onclick = loadView;
  await loadView();
}
/** The caller supplies its configured trusted account origin, never an app document URL. */
export function openSharing(origin, fileId) {
  const target = new URL(origin);
  if (
    !["http:", "https:"].includes(target.protocol) ||
    target.username ||
    target.password
  )
    throw Error("Sharing requires an HTTP origin.");
  const trustedOrigin = target.origin;
  const dialog = element("dialog", "", "pg-sharing-dialog");
  dialog.setAttribute("aria-label", "Share");
  const header = element("div", "", "pg-sharing-header");
  header.append(element("h2", "Share"));
  const close = element("button", "×");
  close.type = "button";
  close.setAttribute("aria-label", "Close sharing");
  header.append(close);
  const loading = element("p", "Loading sharing…", "pg-account-loading");
  loading.setAttribute("role", "status");
  const frame = element("iframe", "", "pg-sharing-frame");
  frame.title = "Sharing settings";
  frame.referrerPolicy = "no-referrer";
  const theme = () =>
    document.documentElement.dataset.theme === "dark" ? "dark" : "light";
  frame.src = `${trustedOrigin}/?sharing=${encodeURIComponent(fileId)}&embed=1&theme=${theme()}`;
  frame.addEventListener("load", () => {
    frame.contentWindow?.postMessage(
      { type: "pagegi-embed", event: "theme", theme: theme() },
      trustedOrigin,
    );
  });
  const retry = element("button", "Try again");
  retry.type = "button";
  retry.hidden = true;
  let timeout;
  const start = () => {
    clearTimeout(timeout);
    loading.hidden = false;
    loading.textContent = "Loading sharing…";
    retry.hidden = true;
    timeout = setTimeout(() => {
      loading.textContent = "Could not load sharing. Please try again.";
      retry.hidden = false;
    }, 15000);
  };
  retry.onclick = () => {
    start();
    frame.src = frame.src;
  };
  start();
  dialog.append(header, loading, retry, frame);
  const opener = document.activeElement;
  const receive = (event) => {
    if (
      event.origin === trustedOrigin &&
      event.source === frame.contentWindow &&
      event.data?.type === "pagegi-sharing"
    ) {
      if (event.data.event === "close") dialog.close();
      if (event.data.event === "ready") {
        clearTimeout(timeout);
        loading.hidden = true;
        retry.hidden = true;
      }
    }
  };
  addEventListener("message", receive);
  close.onclick = () => dialog.close();
  dialog.addEventListener(
    "close",
    () => {
      clearTimeout(timeout);
      removeEventListener("message", receive);
      dialog.remove();
      if (opener?.isConnected) opener.focus();
    },
    { once: true },
  );
  document.body.append(dialog);
  dialog.showModal();
  close.focus();
  return { close: () => dialog.close() };
}
