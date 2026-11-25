/** Pick the wrap target from a dialog's ordered Tab stops. */
export function tabWrapTarget(
  stops: readonly HTMLElement[],
  active: Element | null,
  backwards: boolean,
  entering: boolean,
): HTMLElement | undefined {
  const first = stops[0];
  const last = stops.at(-1);
  if (backwards) return entering || active === first ? last : undefined;
  return entering || active === last ? first : undefined;
}
