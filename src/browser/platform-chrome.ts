import type {
  PlatformChrome,
  PlatformChromeOptions,
  ChromeAction,
  ColorMode,
} from "./platform-chrome-contracts.ts";
import type { SharingPreferences } from "../contracts.ts";
import {
  avatar,
  icon,
  panelController,
  themeChoice,
  applyTheme,
  viewerAppearance,
  chooseDesignSystem,
} from "./identity.js";
import { DESIGN_SYSTEMS } from "../af-contracts.ts";
import type { DesignSystemName } from "../af-contracts.ts";
import { otherViewers } from "../chrome-model.ts";
import { createViewerControls } from "./viewer-controls.ts";
/** Owns platform presentation and focus. All document/account effects are semantic commands. */
export function createPlatformChrome(
  options: PlatformChromeOptions,
): PlatformChrome {
  const bar = document.createElement("nav");
  bar.id = "pg-bar";
  bar.className = "pg-bar";
  bar.dataset.pagegiUi = "";
  bar.setAttribute("aria-label", "artifactbin");
  bar.innerHTML =
    '<span class="pg-brand">artifactbin</span><button id="pg-library" hidden>Artifacts</button><span id="pg-status" role="status"></span><div id="pg-people"></div><button id="pg-return" hidden>Return</button><button id="pg-connect">Connect</button><button id="pg-settings" aria-label="Page settings" aria-expanded="false" class="pg-bar-action"></button><button id="pg-me" aria-label="Account menu" aria-expanded="false" class="pg-bar-action">?</button><section id="pg-popover" class="pg-popover pg-panel" hidden></section>';
  const control = (id: string) => bar.querySelector<HTMLElement>("#pg-" + id)!;
  const settings = control("settings"),
    account = control("me"),
    people = control("people"),
    status = control("status");
  const popover = control("popover");
  popover.dataset.pagegiUi = "";
  document.body.append(popover);
  const panels = panelController(popover);
  settings.append(icon("settings")!);
  const context = document.createElement("div");
  context.className = "pg-context";
  context.setAttribute("role", "menu");
  context.hidden = true;
  context.dataset.pagegiUi = "";
  document.body.append(context);
  for (const surface of [bar, popover, context])
    surface.addEventListener("click", () => options.beginAction?.(), {
      capture: true,
    });
  const viewerControls = createViewerControls(people, (sessionId) =>
    act({ kind: "view-person", sessionId }),
  );
  let theme: ColorMode = themeChoice(),
    disposed = false;
  function act(action: ChromeAction) {
    if (disposed) return;
    return Promise.resolve()
      .then(() => options.act(action))
      .catch((error) => options.error(error.message));
  }
  function button(
    label: string,
    action: () => unknown,
    parent: HTMLElement,
    cls = "",
  ) {
    const el = document.createElement("button");
    el.textContent = label;
    el.className = cls;
    el.onclick = () => {
      if (!disposed)
        Promise.resolve()
          .then(action)
          .catch((error) => options.error(error.message));
    };
    parent.append(el);
    return el;
  }
  function para(text: string, parent: HTMLElement, cls = "") {
    const el = document.createElement("p");
    el.textContent = text;
    el.className = cls;
    parent.append(el);
  }
  function open(opener: HTMLElement, label: string) {
    popover.replaceChildren();
    panels.open(opener, label);
    return popover;
  }
  function command(
    label: string,
    action: ChromeAction,
    parent: HTMLElement,
    glyph?: string,
    focus = false,
  ) {
    const el = button(
      label,
      () => {
        panels.close(focus);
        return act(action);
      },
      parent,
    );
    if (glyph) el.prepend(icon(glyph)!);
    return el;
  }
  function accountMenu() {
    const view = options.read(),
      p = open(account, "Account options");
    para("artifactbin", p, "pg-panel-brand");
    para(view.actor ? "Connected as " + view.actor : "Not signed in", p);
    if (view.remote) {
      command("Account & profile", { kind: "account" }, p, "user");
      command("Share", { kind: "share" }, p, "file");
    }
    command("Add comment", { kind: "add-comment" }, p, "comment");
    command("Comment on page", { kind: "page-comment" }, p, "comment");
    if (view.connected)
      command("Disconnect", { kind: "disconnect" }, p, "logout");
    panels.focus();
  }
  function settingsMenu() {
    const view = options.read(),
      p = open(settings, "Page settings");
    const heading = document.createElement("div");
    heading.className = "pg-panel-heading";
    const title = document.createElement("h2");
    title.textContent = "page settings";
    heading.append(title);
    const dismiss = button("", () => panels.close(true), heading);
    dismiss.append(icon("close")!);
    dismiss.setAttribute("aria-label", "Dismiss page settings");
    p.append(heading);
    const body = document.createElement("div");
    body.className = "pg-settings-body";
    p.append(body);
    if (view.remote) {
      para("document access", body, "pg-label");
      command(
        "Share / Manage access",
        { kind: "share" },
        body,
        undefined,
        true,
      );
      para(
        "Choose who can open this document and what they can do.",
        body,
        "pg-caption",
      );
    }
    para("document", body, "pg-label");
    command("Add comment", { kind: "add-comment" }, body, "comment", true);
    command("Comment on page", { kind: "page-comment" }, body, "comment", true);
    command("Download HTML", { kind: "download" }, body, "download", true);
    para("appearance", body, "pg-label");
    const appearance = document.createElement("div");
    appearance.className = "pg-appearance";
    appearance.setAttribute("role", "group");
    appearance.setAttribute("aria-label", "Color mode");
    body.append(appearance);
    for (const next of ["light", "dark"] as const) {
      const el = button(next, () => setTheme(next), appearance);
      el.dataset.mode = next;
      el.setAttribute(
        "aria-label",
        next === "light" ? "Light mode" : "Dark mode",
      );
      el.setAttribute("aria-pressed", String(theme === next));
      el.prepend(icon(next === "light" ? "sun" : "moon")!);
    }
    const designRow = document.createElement("label");
    designRow.className = "pg-design-system";
    designRow.append(document.createTextNode("Design system "));
    const design = document.createElement("select");
    design.setAttribute("aria-label", "Design system");
    for (const name of ["", ...DESIGN_SYSTEMS]) {
      const option = document.createElement("option");
      option.value = name;
      option.textContent = name || "Page default";
      design.append(option);
    }
    design.value = viewerAppearance().designSystem ?? "";
    design.onchange = () => {
      const designSystem = (design.value || null) as DesignSystemName | null;
      chooseDesignSystem(designSystem);
      void act({ kind: "design-system", designSystem });
    };
    designRow.append(design);
    body.append(designRow);
    if (view.remote) {
      const sharing = document.createElement("details"),
        summary = document.createElement("summary");
      summary.textContent = "Presence & cursors";
      sharing.append(summary);
      para(
        "Control what collaborators see while you are here. This does not change document access.",
        sharing,
        "pg-caption",
      );
      body.append(sharing);
      for (const [key, label] of Object.entries({
        visible: "Show that I am here",
        shareCursor: "Share my cursor",
        showCursors: "Show other cursors",
        shareView: "Share my current view",
        shareSelection: "Share my selections",
        showSelections: "Show other selections",
      }) as [keyof SharingPreferences, string][]) {
        const row = document.createElement("label"),
          input = document.createElement("input");
        input.type = "checkbox";
        input.checked = view.preferences[key];
        input.onchange = () => {
          void act({ kind: "preference", key, value: input.checked });
        };
        row.append(input, document.createTextNode(label));
        sharing.append(row);
      }
    }
    para(status.textContent || "", body, "pg-caption");
    panels.focus();
  }
  function setTheme(next: ColorMode, persist = true) {
    if (disposed) return;
    theme = next;
    applyTheme(theme, persist);
    for (const el of popover.querySelectorAll<HTMLElement>("[data-mode]"))
      el.setAttribute("aria-pressed", String(el.dataset.mode === theme));
    if (persist) void act({ kind: "theme", theme });
  }
  const onTheme = (event: Event) => {
    const next = (event as CustomEvent).detail;
    if (next === "light" || next === "dark") setTheme(next);
  };
  addEventListener("pagegi-theme", onTheme);
  settings.onclick = () =>
    settings.getAttribute("aria-expanded") === "true"
      ? panels.close()
      : settingsMenu();
  account.onclick = () =>
    account.getAttribute("aria-expanded") === "true"
      ? panels.close()
      : accountMenu();
  control("return").onclick = () => {
    void act({ kind: "return" });
  };
  control("connect").onclick = () => {
    void act({ kind: "connect" });
  };
  control("library").onclick = () => {
    void act({ kind: "library" });
  };
  applyTheme(theme, false);
  return {
    bar,
    get theme() {
      return theme;
    },
    renderIdentity() {
      if (!disposed) {
        const view = options.read();
        avatar(account, view.profiles[view.actor || ""], view.actor || "?");
      }
    },
    renderPeople() {
      if (disposed) return;
      const view = options.read(),
        viewers = otherViewers(view.viewers, view.actor, view.sessionId);
      viewerControls.render(viewers, view.profiles);
    },
    setTheme,
    setStatus(label) {
      if (!disposed) status.textContent = label;
    },
    showApproval(url) {
      if (disposed) return;
      const link = document.createElement("a");
      link.href = url;
      link.target = "_blank";
      link.rel = "noopener";
      link.textContent = "Sign in to connect";
      status.replaceChildren(link);
    },
    showConnect(show) {
      control("connect").hidden = !show;
    },
    showReturn(show) {
      control("return").hidden = !show;
    },
    showLibrary(show) {
      control("library").hidden = !show;
    },
    promptConnection() {
      if (disposed) return;
      const p = open(account, "Account options");
      para(
        "Publish this file to your artifactbin server. Your account will be used to sync its local comments.",
        p,
      );
      const label = document.createElement("label");
      label.textContent = "Server URL";
      const input = document.createElement("input");
      input.type = "url";
      input.placeholder = "https://pagegi.example";
      input.style.width = "100%";
      label.append(input);
      p.append(label);
      button(
        "Publish and connect",
        () => act({ kind: "connect", origin: input.value }),
        p,
        "primary",
      );
    },
    context(selection, x, y) {
      if (disposed) return;
      const view = options.read();
      context.replaceChildren();
      context.hidden = false;
      context.style.left = Math.max(8, Math.min(innerWidth - 190, x)) + "px";
      context.style.top =
        Math.max(
          bar.offsetHeight,
          Math.min(innerHeight - 60, y + bar.offsetHeight),
        ) + "px";
      const el = button(
        view.canComment
          ? "Add comment"
          : view.actor
            ? "View-only access"
            : "Sign in to comment",
        () => {
          context.hidden = true;
          return act({ kind: "comment-context", selection });
        },
        context,
      );
      el.disabled = !view.canComment && !!view.actor;
      el.setAttribute("role", "menuitem");
      el.focus();
    },
    hideContext() {
      context.hidden = true;
    },
    close(focus = false) {
      panels.close(focus);
    },
    dismissOutside(target) {
      if (!context.contains(target)) context.hidden = true;
      if (
        !popover.contains(target) &&
        !account.contains(target) &&
        !settings.contains(target)
      )
        panels.close();
    },
    dispose() {
      disposed = true;
      removeEventListener("pagegi-theme", onTheme);
      panels.dispose();
      viewerControls.dispose();
      bar.remove();
      popover.remove();
      context.remove();
    },
  };
}
