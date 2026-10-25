---
name: diagrams
description: Author Mermaid diagrams directly in native HTML pages.
---

## Read first

Use the pinned Mermaid ESM module directly. It is a JavaScript library, not a platform custom element. Keep diagram source in the page, initialize Mermaid before rendering, and render into a page-owned element.

## Contents

[Example](#minimal-example) · [Theme](#theme-updates-and-cleanup) · [Offline](#offline-and-data-limits) · [API](#api-reference)

## Minimal example

```html
<figure>
  <div id="workflow" data-af-id="workflow-diagram" role="img" aria-label="A request is reviewed, then approved or returned"></div>
  <figcaption>Request review flow</figcaption>
  <p id="workflow-error" data-af-id="workflow-status" role="status" hidden></p>
</figure>
<script type="module">
import mermaid from "/libraries/mermaid-12.0.0/index.js";

const target = document.querySelector("#workflow");
const source = `flowchart LR
  Draft --> Review
  Review -->|approved| Done
  Review -->|changes| Draft`;
const error = document.querySelector("#workflow-error");
let generation = 0;
let disposed = false;

async function render() {
  const request = ++generation;
  const isDark = document.documentElement.dataset.afDark === "true";
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    theme: "base",
    themeVariables: {
      background: isDark ? "#171923" : "#ffffff",
      primaryColor: isDark ? "#283348" : "#e8f1ff",
      primaryTextColor: isDark ? "#f4f6fb" : "#172033",
      lineColor: isDark ? "#a9bddb" : "#45556f"
    },
    fontFamily: "system-ui, sans-serif"
  });
  try {
    await document.fonts.ready;
    const {svg, bindFunctions} = await mermaid.render(`workflow-${request}`, source);
    if (disposed || request !== generation) return;
    target.innerHTML = svg;
    bindFunctions?.(target);
    error.hidden = true;
    error.textContent = "";
  } catch {
    if (disposed || request !== generation) return;
    target.replaceChildren();
    error.hidden = false;
    error.textContent = "Diagram unavailable. The workflow is described in the caption.";
  }
}

const themeObserver = new MutationObserver(() => void render());
themeObserver.observe(document.documentElement, {attributes: true, attributeFilter: ["data-af-dark"]});
window.addEventListener("pagehide", dispose, {once: true});
function dispose() {
  disposed = true;
  generation++;
  themeObserver.disconnect();
  target.replaceChildren();
  window.removeEventListener("pagehide", dispose);
}
void render();
</script>
```

Use a unique render ID for every diagram. Mermaid returns generated SVG; insert only the SVG returned by Mermaid, not user-provided markup. Keep `securityLevel: "strict"` for untrusted or shared text and do not add HTML labels from untrusted data.

## Theme, updates and cleanup

Mermaid does not automatically use the page's design-system tokens. The example observes `data-af-dark`, sets explicit `themeVariables`, and rerenders when the page theme changes. Resolve concrete colors from the chosen design system when its palette matters. Await `document.fonts.ready` before rendering so the saved diagram uses the intended font metrics. The status text gives readers an accessible fallback if rendering fails.

For changing diagrams, keep a monotonically increasing render generation. Ignore a completed render if a newer render has started, then replace the target's contents and bind functions for the current generation only. Remove the SVG and any page-owned listeners when the containing view is disposed. Mermaid has no per-render `finalize()` method; do not leave app-owned theme observers or listeners running after disposal.

## Offline and data limits

The versioned module is included with the saved page's admitted library assets, so rendering the source above needs no CDN. A diagram that references remote images, fonts or application data still depends on those resources being available and admitted. Prefer labels and inline diagram syntax for a portable saved page; show an explicit unavailable state when a separately loaded resource is missing.

The legacy `<af-mermaid>` component remains available for existing pages. New native HTML pages should use this direct API.

## API reference

- [Mermaid 12 API](https://mermaid.js.org/config/usage.html)
- [Security configuration](https://mermaid.js.org/config/schema-docs/config.html#securitylevel)
