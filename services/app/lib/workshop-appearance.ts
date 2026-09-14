import { useSyncExternalStore } from "react";

export type WorkshopAppearance = "indoor" | "outdoor";
const KEY = "artifactbin-workshop-appearance";
const EVENT = "artifactbin:workshop-appearance";
const read = (): WorkshopAppearance => {
  try {
    return localStorage.getItem(KEY) === "outdoor" ? "outdoor" : "indoor";
  } catch {
    return "indoor";
  }
};
const subscribe = (notify: () => void) => {
  window.addEventListener(EVENT, notify);
  window.addEventListener("storage", notify);
  return () => {
    window.removeEventListener(EVENT, notify);
    window.removeEventListener("storage", notify);
  };
};
export function setWorkshopAppearance(value: WorkshopAppearance) {
  try {
    localStorage.setItem(KEY, value);
  } catch {
    /* Storage may be unavailable. */
  }
  window.dispatchEvent(new Event(EVENT));
}
export const useWorkshopAppearance = () =>
  useSyncExternalStore(subscribe, read, () => "indoor" as const);
