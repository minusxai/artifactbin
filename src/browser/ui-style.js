// @ts-check
import { parse, generate, walk } from "css-tree";
/** Keep the platform's existing look without restyling author controls in local mode. */
export function localChromeCSS(css) {
  const scope = "[data-pagegi-ui][data-pagegi-ui]";
  const ast = parse(css);
  walk(ast, {
    visit: "Rule",
    enter(node, item, list) {
      if (node.prelude?.type !== "SelectorList") return;
      const selectors = [];
      node.prelude.children.forEach((selector) => {
        const value = generate(selector);
        if (value.startsWith(":root")) {
          selectors.push(value);
          return;
        }
        if (value === "html" || value === "body") return;
        // Constrain the matched subject, not its ancestors: the UI root itself
        // may satisfy an ancestor in selectors such as `.pg-bar button`.
        const pseudo = value.match(/::[\w-]+(?:\([^)]*\))?$/)?.[0] || "";
        const subject = pseudo ? value.slice(0, -pseudo.length) : value;
        selectors.push(subject + ":is(" + scope + "," + scope + " *)" + pseudo);
      });
      if (!selectors.length) {
        list.remove(item);
        return;
      }
      node.prelude = parse(selectors.join(","), { context: "selectorList" });
    },
  });
  return (
    `${scope},${scope} :where(:not(svg,svg *)),${scope}::before,${scope}::after,${scope} *::before,${scope} *::after{all:revert}` +
    generate(ast) +
    "\n[data-pagegi-ui][data-pagegi-ui]{font:14px/1.5 var(--pg-sans);color:var(--pg-fg)}#pg-bar[data-pagegi-ui][data-pagegi-ui]{position:fixed;left:0;right:0;top:0;height:44px;z-index:2147483000}#pg-history[data-pagegi-ui][data-pagegi-ui]{position:fixed;inset:44px 0 0;width:100%;height:calc(100% - 44px);border:0;background:white;z-index:5}"
  );
}
