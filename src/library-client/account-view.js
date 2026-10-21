import { openAccount } from "/account.js";
import {
  avatar,
  photo,
  themeChoice,
  applyTheme,
  icon,
  panelController,
} from "/identity.js";
/** @param {import("./view-contracts.ts").AccountViewOptions} options
 * @returns {import("./view-contracts.ts").AccountView} */
export function mountAccount({
  $,
  request,
  load,
  frameEvent,
  embedded,
  parentOrigin,
}) {
  let profile = { name: "", image: null };
  applyTheme(embedded ? document.documentElement.dataset.theme : themeChoice(), false);
  function previewPhoto() {
    $("profile-preview").hidden = !profile.image;
    $("profile-preview").src = profile.image || "";
    $("remove-photo").hidden = !profile.image;
    $("choose-photo").textContent = profile.image
      ? "Change photo"
      : "Upload photo";
  }
  /** Account secrets, by name only: a saved value never comes back from the server. */
  let secretsVersion = 0;
  function secretError(text) {
    $("secret-error").textContent = text;
  }
  function renderSecrets(secrets) {
    const list = $("secrets-list");
    list.replaceChildren(
      ...secrets.map((secret) => {
        const item = document.createElement("li");
        const name = document.createElement("span");
        name.className = "secret-name";
        name.textContent = secret.name;
        const time = document.createElement("span");
        time.className = "secret-time";
        time.textContent = "set " + new Date(secret.updatedAt).toLocaleString();
        const remove = document.createElement("button");
        remove.type = "button";
        remove.textContent = "Remove";
        remove.setAttribute("aria-label", "Remove " + secret.name);
        remove.onclick = async () => {
          if (!confirm(`Remove the secret ${secret.name}? Lambdas that read env.${secret.name} will no longer get it.`)) return;
          remove.disabled = true;
          try {
            await request("/api/secrets/" + encodeURIComponent(secret.name), undefined, "DELETE");
            secretError("");
            await loadSecrets();
          } catch (e) {
            remove.disabled = false;
            secretError(e.message);
          }
        };
        item.append(name, time, remove);
        return item;
      }),
    );
    $("secrets-empty").hidden = secrets.length > 0;
  }
  async function loadSecrets() {
    const version = ++secretsVersion;
    try {
      const { secrets } = await request("/api/secrets");
      if (version !== secretsVersion) return;
      renderSecrets(secrets || []);
    } catch (e) {
      if (version !== secretsVersion) return;
      renderSecrets([]);
      $("secrets-empty").hidden = true;
      secretError(e.message);
    }
  }
  $("secret-form").onsubmit = async (e) => {
    e.preventDefault();
    const name = $("secret-name").value.trim();
    const value = $("secret-value").value;
    const controls = [$("secret-name"), $("secret-value"), $("secret-form").querySelector("[type=submit]")];
    controls.forEach((c) => (c.disabled = true));
    try {
      await request("/api/secrets/" + encodeURIComponent(name), { value }, "PUT");
      secretError("");
      $("secret-name").value = "";
      $("secret-value").value = "";
      await loadSecrets();
    } catch (err) {
      secretError(err.message);
    } finally {
      // The value stays only in the field, and only until it is saved.
      controls.forEach((c) => (c.disabled = false));
    }
  };
  /** The account's handle, the public name in /@<handle>/<path> addresses (null: none). */
  let handleVersion = 0;
  function showHandle(handle) {
    $("handle-input").value = handle || "";
    $("handle-clear").hidden = !handle;
    $("handle-address").hidden = !handle;
    $("handle-example").textContent = handle ? `${location.origin}/@${handle}/<path>` : "";
  }
  async function loadHandle() {
    const version = ++handleVersion;
    try {
      const { handle } = await request("/api/account/handle");
      if (version !== handleVersion) return;
      showHandle(handle);
      $("handle-error").textContent = "";
    } catch (e) {
      if (version === handleVersion) $("handle-error").textContent = e.message;
    }
  }
  async function changeHandle(body, method, done) {
    const controls = [$("handle-input"), $("handle-clear"), $("handle-form").querySelector("[type=submit]")];
    controls.forEach((c) => (c.disabled = true));
    $("handle-status").textContent = "";
    const version = ++handleVersion;
    try {
      const { handle } = await request("/api/account/handle", body, method);
      if (version === handleVersion) showHandle(handle);
      $("handle-error").textContent = "";
      $("handle-status").textContent = done;
    } catch (err) {
      $("handle-error").textContent = err.message;
    } finally {
      controls.forEach((c) => (c.disabled = false));
    }
  }
  $("handle-form").onsubmit = (e) => {
    e.preventDefault();
    const handle = $("handle-input").value.trim();
    if (!handle) {
      $("handle-error").textContent = "Enter a handle, or choose Remove handle.";
      return;
    }
    changeHandle({ handle }, "PUT", "Handle saved.");
  };
  $("handle-clear").onclick = () => changeHandle(undefined, "DELETE", "Handle removed.");
  const accountPanel = panelController($("home-menu"));
  const settingsPanel = panelController($("home-settings-panel"));
  $("home-settings").append(icon("settings"));
  $("settings-close").append(icon("close"));
  $("menu-light").prepend(icon("sun"));
  $("menu-dark").prepend(icon("moon"));
  $("account-link").prepend(icon("user"));
  $("account-link").onclick = (e) => {
    e.preventDefault();
    closeMenu();
    openAccount(location.origin, async () => {
      try {
        profile = await request("/api/library/profile");
      } catch {
        await load();
        return;
      }
      avatar($("account-menu"), profile, $("account-email").textContent);
      $("menu-identity").textContent =
        profile.name || $("account-email").textContent;
    });
  };
  $("menu-documents").prepend(icon("file"));
  $("menu-sign-out").prepend(icon("logout"));
  function closeMenu(focus = false) {
    accountPanel.close(focus);
  }
  $("account-menu").onclick = () => {
    settingsPanel.close();
    if (!$("home-menu").hidden) closeMenu();
    else {
      accountPanel.open($("account-menu"), "Account options");
      accountPanel.focus();
    }
  };
  $("home-settings").onclick = () => {
    closeMenu();
    if (!$("home-settings-panel").hidden) settingsPanel.close();
    else {
      settingsPanel.open($("home-settings"), "Page settings");
      settingsPanel.focus();
    }
  };
  $("settings-close").onclick = () => settingsPanel.close(true);
  $("choose-photo").onclick = () => $("profile-photo").click();
  $("profile-photo").onchange = async () => {
    const controls = [
      $("profile-photo"),
      $("remove-photo"),
      $("profile-form").querySelector("[type=submit]"),
    ];
    controls.forEach((c) => (c.disabled = true));
    $("profile-status").textContent = "Preparing photo…";
    try {
      profile.image = await photo($("profile-photo").files[0]);
      previewPhoto();
      $("profile-status").textContent = "Ready to save.";
    } catch (e) {
      $("profile-status").textContent = e.message;
    }
    $("profile-photo").value = "";
    controls.forEach((c) => (c.disabled = false));
  };
  $("remove-photo").onclick = () => {
    profile.image = null;
    previewPhoto();
    $("profile-status").textContent = "Ready to save.";
  };
  $("profile-form").onsubmit = async (e) => {
    e.preventDefault();
    if (!$("profile-name").value.trim()) {
      $("profile-status").textContent = "Enter a display name.";
      return;
    }
    try {
      profile = await request("/api/library/profile", {
        name: $("profile-name").value,
        image: profile.image,
      });
      avatar($("account-menu"), profile, $("account-email").textContent);
      $("menu-identity").textContent =
        profile.name || $("account-email").textContent;
      $("profile-status").textContent = "Profile saved.";
      frameEvent("profile-changed");
    } catch (e) {
      $("profile-status").textContent = e.message;
    }
  };
  function setAppearance(next) {
    applyTheme(next);
    for (const mode of ["light", "dark"])
      for (const id of [mode + "-mode", "menu-" + mode])
        $(id).setAttribute("aria-pressed", String(mode === next));
  }
  for (const next of ["light", "dark"])
    for (const id of [next + "-mode", "menu-" + next])
      $(id).onclick = () => {
        setAppearance(next);
        if (embedded)
          parent.postMessage(
            { type: "pagegi-account", event: "theme-changed", theme: next },
            parentOrigin,
          );
      };
  setAppearance(
    embedded ? document.documentElement.dataset.theme : themeChoice(),
  );
  addEventListener("message", (event) => {
    if (
      embedded &&
      event.source === parent &&
      event.data?.type === "pagegi-embed" &&
      event.data.event === "theme" &&
      ["light", "dark"].includes(event.data.theme)
    )
      setAppearance(event.data.theme);
  });
  addEventListener("pagegi-theme", (event) => {
    if (["light", "dark"].includes(event.detail)) setAppearance(event.detail);
  });

  return {
    close: closeMenu,
    update(next, username) {
      profile = next;
      $("account-email").textContent = username;
      $("menu-identity").textContent = profile.name || username;
      avatar($("account-menu"), profile, username);
      $("profile-name").value = profile.name;
      previewPhoto();
      loadSecrets();
      loadHandle();
    },
  };
}
