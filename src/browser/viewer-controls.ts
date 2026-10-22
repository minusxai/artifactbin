import type { ViewerControls } from "./viewer-controls-contracts.ts";
import { avatar } from "./identity.js";

/** Profile arrival must not replace a control while the user is clicking it. */
export function createViewerControls(
  people: HTMLElement,
  activate: (sessionId: string) => unknown,
): ViewerControls {
  const entries = new Map<
    string,
    {
      button: HTMLButtonElement;
      initial: Text;
      image: HTMLImageElement;
      sessionId: string;
    }
  >();
  let disposed = false;
  return {
    render(viewers, profiles) {
      if (disposed) return;
      const present = new Set(viewers.map((viewer) => viewer.actor));
      for (const [actor, entry] of entries) {
        if (!present.has(actor)) {
          entry.button.remove();
          entries.delete(actor);
        }
      }
      people.hidden = !viewers.length;
      viewers.forEach((viewer, index) => {
        let entry = entries.get(viewer.actor);
        if (!entry) {
          const button = document.createElement("button");
          button.className = "pg-person";
          // Build the same avatar as other platform controls once, then update
          // its existing text/image nodes rather than replacing pointer targets.
          avatar(button, undefined, viewer.actor);
          const face = button.querySelector<HTMLElement>(".pg-face")!;
          const initial = face.firstChild as Text;
          const image = document.createElement("img");
          image.alt = "";
          image.hidden = true;
          image.onerror = () => {
            image.hidden = true;
          };
          face.append(image);
          entry = { button, initial, image, sessionId: viewer.sessionId };
          const current = entry;
          button.onclick = () => {
            if (!disposed) void activate(current.sessionId);
          };
          entries.set(viewer.actor, entry);
        }
        entry.sessionId = viewer.sessionId;
        const profile = profiles[viewer.actor];
        const name = profile?.name || viewer.actor;
        entry.initial.nodeValue = (name.trim()[0] || "?").toUpperCase();
        const image = profile?.image;
        if (image && /^data:image\/(png|jpeg|webp);base64,/.test(image)) {
          if (entry.image.getAttribute("src") !== image)
            entry.image.src = image;
          entry.image.hidden = false;
        } else {
          entry.image.hidden = true;
          entry.image.removeAttribute("src");
        }
        entry.button.setAttribute(
          "aria-label",
          "View " + viewer.actor + "'s snapshot",
        );
        entry.button.setAttribute(
          "aria-description",
          viewer.shareView ? "View sharing is on" : "View sharing is off",
        );
        if (people.children[index] !== entry.button)
          people.insertBefore(entry.button, people.children[index] ?? null);
      });
    },
    dispose() {
      disposed = true;
      entries.clear();
      people.replaceChildren();
    },
  };
}
