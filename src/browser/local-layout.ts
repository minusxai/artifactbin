import type {
  LocalLayout,
  LocalLayoutOptions,
} from "./local-layout-contracts.ts";
/** A root inset leaves body margins/padding and author DOM structure intact. */
export function installLocalLayout({
  document,
  inset,
}: LocalLayoutOptions): LocalLayout {
  if (!Number.isFinite(inset) || inset < 0)
    throw Error("Invalid local toolbar inset");
  const window = document.defaultView;
  if (!window) throw Error("Document has no window");
  const style = document.createElement("style");
  style.dataset.pagegiUi = "";
  document.head.append(style);
  let disposed = false;
  function refresh() {
    if (disposed) return;
    style.textContent = "";
    const authored = window!.getComputedStyle(
      document.documentElement,
    ).paddingTop;
    style.textContent = `:root{padding-top:calc(${authored} + ${inset}px)!important}`;
  }
  window.addEventListener("resize", refresh);
  refresh();
  return {
    refresh,
    dispose() {
      if (disposed) return;
      disposed = true;
      window.removeEventListener("resize", refresh);
      style.remove();
    },
  };
}
