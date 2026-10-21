// The trusted account frame owns authentication. No account credentials enter this document.
let current;
/** @type {import('../account-contracts.ts').OpenAccount} */
export function openAccount(origin, onChanged) {
  const target = new URL(origin);
  if (!["http:", "https:"].includes(target.protocol))
    throw new Error("Account settings require an HTTP origin.");
  const trustedOrigin = target.origin;
  if (current?.origin !== trustedOrigin) {
    current?.destroy();
    current = createAccount(trustedOrigin);
  }
  current.onChanged = onChanged;
  current.syncTheme();
  if (!current.dialog.open) {
    current.opener = document.activeElement;
    current.dialog.showModal();
    current.closeButton.focus();
  }
  return { close: current.close };
}
function createAccount(origin) {
  const dialog = document.createElement("dialog");
  dialog.dataset.pagegiUi="";
  dialog.className = "pg-account-dialog";
  dialog.setAttribute("aria-label", "Account");
  const header = document.createElement("div");
  header.className = "pg-account-header";
  const heading = document.createElement("h2");
  heading.textContent = "Account";
  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.className = "pg-account-close";
  closeButton.setAttribute("aria-label", "Close account");
  closeButton.textContent = "×";
  header.append(heading, closeButton);
  const loading = document.createElement("p");
  loading.className = "pg-account-loading";
  loading.setAttribute("role", "status");
  loading.textContent = "Loading account…";
  const retry = document.createElement("button");
  retry.type = "button";
  retry.textContent = "Try again";
  retry.hidden = true;
  const frame = document.createElement("iframe");
  frame.title = "Account settings";
  frame.className = "pg-account-frame";
  frame.referrerPolicy = "origin";
  // Deliberately no opener, token, document state or parent URL in this address.
  const theme = () =>
    document.documentElement.dataset.theme === "dark" ? "dark" : "light";
  const syncTheme = () =>
    frame.contentWindow?.postMessage(
      { type: "pagegi-embed", event: "theme", theme: theme() },
      origin,
    );
  frame.src = `${origin}/?account=1&embed=1&theme=${theme()}`;
  dialog.append(header, loading, retry, frame);
  let timeout;
  const start = () => {
    clearTimeout(timeout);
    loading.hidden = false;
    loading.textContent = "Loading account…";
    retry.hidden = true;
    timeout = setTimeout(() => {
      loading.textContent = "Could not load account. Please try again.";
      retry.hidden = false;
    }, 15000);
  };
  retry.onclick = () => {
    start();
    frame.src = frame.src;
  };
  start();
  const state = {
    origin,
    dialog,
    closeButton,
    syncTheme,
    opener: null,
    onChanged: undefined,
    close() {
      dialog.close();
    },
    destroy() {
      dialog.close();
      clearTimeout(timeout);
      dialog.remove();
      removeEventListener("message", receive);
    },
  };
  const ready = () => {
    clearTimeout(timeout);
    syncTheme();
    loading.hidden = true;
    retry.hidden = true;
  };
  const receive = (event) => {
    if (
      event.origin !== origin ||
      event.source !== frame.contentWindow ||
      event.data?.type !== "pagegi-account"
    )
      return;
    switch (event.data.event) {
      case "ready":
        ready();
        break;
      case "theme-changed":
        if (["light", "dark"].includes(event.data.theme))
          dispatchEvent(
            new CustomEvent("pagegi-theme", { detail: event.data.theme }),
          );
        break;
      case "profile-changed":
        Promise.resolve()
          .then(() => state.onChanged?.())
          .catch(() => {});
        break;
      case "close":
        state.close();
        break;
    }
  };
  frame.addEventListener("load", syncTheme);
  closeButton.onclick = state.close;
  dialog.addEventListener("click", (event) => {
    if (event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    if (
      event.clientX < bounds.left ||
      event.clientX > bounds.right ||
      event.clientY < bounds.top ||
      event.clientY > bounds.bottom
    )
      state.close();
  });
  dialog.addEventListener("close", () => {
    if (state.opener?.isConnected) state.opener.focus();
  });
  addEventListener("message", receive);
  document.body.append(dialog);
  return state;
}
