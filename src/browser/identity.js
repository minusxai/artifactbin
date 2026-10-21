// Identity and app-panel interactions shared by the library and portable runtime.
export function avatar(el, profile, fallback = "?") {
  el.replaceChildren();
  el.classList.add("pg-avatar");
  const name = profile?.name || fallback;
  const face = document.createElement("span");
  face.className = "pg-face";
  face.setAttribute("aria-hidden", "true");
  let hue = 0;
  for (const c of fallback) hue = (hue * 31 + c.charCodeAt(0)) % 360;
  face.style.setProperty("--pg-face-color", `hsl(${hue} 55% 30%)`);
  face.textContent = (name.trim()[0] || "?").toUpperCase();
  if (
    profile?.image &&
    /^data:image\/(png|jpeg|webp);base64,/.test(profile.image)
  ) {
    const image = document.createElement("img");
    image.src = profile.image;
    image.alt = "";
    image.onerror = () => image.remove();
    face.append(image);
  }
  el.append(face);
}
export function icon(name) {
  const paths = {
    settings:
      '<path d="M21 4h-7M10 4H3M21 12h-3M14 12H3M21 20h-9M8 20H3M14 2v4M18 10v4M8 18v4"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    moon: '<path d="M20.9 13A9 9 0 0 1 11 3.1 9 9 0 1 0 20.9 13Z"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
    file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z M14 2v6h6 M8 13h8 M8 17h6"/>',
    download:
      '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
    logout:
      '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
    comment:
      '<path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8Z"/>',
    close: '<path d="m18 6-12 12M6 6l12 12"/>',
    check: '<path d="m20 6-11 11-5-5"/>',
    reply: '<path d="m9 10-5 5 5 5M4 15h11a5 5 0 0 0 0-10h-3"/>',
  };
  const span = document.createElement("span");
  span.innerHTML = `<svg class="pg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.file}</svg>`;
  return span.firstChild;
}
// One panel at a time. The bar stays usable; Escape, scrim and Tab follow Artifactbin's panel contract.
export function panelController(panel) {
  const scrim = document.createElement("button");
  scrim.className = "pg-scrim";
  scrim.setAttribute("aria-label", "Close panel");
  scrim.hidden = true;
  document.body.append(scrim);
  let opener;
  const close = (focus = false) => {
    panel.hidden = scrim.hidden = true;
    opener?.setAttribute("aria-expanded", "false");
    if (focus) opener?.focus();
  };
  scrim.onclick = () => close(true);
  const onKeyDown = (event) => {
    if (panel.hidden) return;
    if (event.key === "Escape") {
      event.preventDefault();
      close(true);
    }
    if (event.key === "Tab") {
      const list = [
        ...panel.querySelectorAll(
          "button:not([disabled]),a[href],input:not([disabled]),summary,textarea",
        ),
      ].filter((el) => el.getClientRects().length);
      const first = list[0],
        last = list.at(-1);
      if (!first) return;
      if (
        event.shiftKey &&
        (!panel.contains(document.activeElement) ||
          document.activeElement === first)
      ) {
        event.preventDefault();
        last.focus();
      } else if (
        !event.shiftKey &&
        (!panel.contains(document.activeElement) ||
          document.activeElement === last)
      ) {
        event.preventDefault();
        first.focus();
      }
    }
  };
  addEventListener("keydown", onKeyDown);
  return {
    dispose() {
      close();
      removeEventListener("keydown", onKeyDown);
      scrim.remove();
    },
    close,
    open(button, label) {
      close();
      opener = button;
      panel.hidden = scrim.hidden = false;
      panel.setAttribute("aria-label", label);
      panel.setAttribute("role", "dialog");
      opener?.setAttribute("aria-expanded", "true");
    },
    focus() {
      panel.querySelector("button,a,input,summary")?.focus();
    },
  };
}
export async function photo(file) {
  if (
    !file ||
    !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
    file.size > 8e6
  )
    throw Error("Choose a PNG, JPEG or WebP photo under 8 MB.");
  const url = URL.createObjectURL(file),
    image = new Image();
  try {
    image.src = url;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 128;
    const ctx = canvas.getContext("2d"),
      side = Math.min(image.width, image.height);
    ctx.drawImage(
      image,
      (image.width - side) / 2,
      (image.height - side) / 2,
      side,
      side,
      0,
      0,
      128,
      128,
    );
    return canvas.toDataURL("image/jpeg", 0.85);
  } finally {
    URL.revokeObjectURL(url);
  }
}
/** The viewer's light/dark pick, else what their system prefers. */
export function themeChoice() {
  try {
    const t = localStorage.getItem("pagegi-theme");
    if (t === "light" || t === "dark") return t;
  } catch {}
  return globalThis.matchMedia?.("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}
const DESIGN_SYSTEM_KEY = "pagegi-design-system";
/** The viewer's own picks for pages: never saved in a page. null means "not chosen". */
export function viewerAppearance() {
  let dark = null,
    designSystem = null;
  try {
    const theme = localStorage.getItem("pagegi-theme");
    if (theme === "light" || theme === "dark") dark = theme === "dark";
    designSystem = localStorage.getItem(DESIGN_SYSTEM_KEY) || null;
  } catch {}
  return { designSystem, dark };
}
/** @param {string | null} name */
export function chooseDesignSystem(name) {
  try {
    if (name) localStorage.setItem(DESIGN_SYSTEM_KEY, name);
    else localStorage.removeItem(DESIGN_SYSTEM_KEY);
  } catch {}
}
/** Show `theme`; `persist` records it as the viewer's pick (false only shows it). */
export function applyTheme(theme, persist = true) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  if (!persist) return;
  try {
    localStorage.setItem("pagegi-theme", theme);
  } catch {}
}
