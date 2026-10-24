// services/app/lib/html-components/tab-navigation.ts
function tabFocusTarget({ key, index, count, orientation, dir, loop }) {
  if (count < 1) return null;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  const forward = orientation === "vertical" ? "ArrowDown" : dir === "rtl" ? "ArrowLeft" : "ArrowRight";
  const backward = orientation === "vertical" ? "ArrowUp" : dir === "rtl" ? "ArrowRight" : "ArrowLeft";
  if (key !== forward && key !== backward) return null;
  const next = index + (key === forward ? 1 : -1);
  return loop ? (next + count) % count : Math.max(0, Math.min(count - 1, next));
}
export {
  tabFocusTarget
};
