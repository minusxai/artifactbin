import { chromium, firefox, webkit } from "playwright";
/** @typedef {"chromium" | "firefox" | "webkit"} BrowserEngineName */
/** @param {string | undefined} selected
 * @returns {Partial<Record<BrowserEngineName, import("playwright").BrowserType>>} */
export function selectBrowserEngines(selected) {
  const engines = { chromium, firefox, webkit };
  if (selected === undefined) return engines;
  if (!Object.hasOwn(engines, selected))
    throw Error(
      "Invalid PAGEGI_TEST_ENGINE: expected chromium, firefox, or webkit",
    );
  const name = /** @type {BrowserEngineName} */ (selected);
  return { [name]: engines[name] };
}
export const browserEngines = selectBrowserEngines(
  process.env.PAGEGI_TEST_ENGINE,
);

/** @typedef {"preview" | "hosted"} SharedStateMode */
/** @param {string | undefined} selected
 * @returns {SharedStateMode[]} */
export function selectSharedStateModes(selected) {
  if (selected === undefined) return ["preview", "hosted"];
  if (selected !== "preview" && selected !== "hosted")
    throw Error("Invalid shared-state mode: expected preview or hosted");
  return [selected];
}
