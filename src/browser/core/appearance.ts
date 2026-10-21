/** Which design system and mode a page shows, and the markup that carries it. Pure. */
import {
  AF_DARK_ATTRIBUTE,
  AF_DESIGN_SYSTEM_ATTRIBUTE,
  AF_DESIGN_SYSTEM_PATH,
  DEFAULT_DESIGN_SYSTEM,
  DESIGN_SYSTEMS,
} from "../../af-contracts.ts";
import type { DesignSystemName } from "../../af-contracts.ts";
import type { Appearance, AppearanceInput, AppearanceModule } from "./core-contracts.ts";

export function isDesignSystem(name: unknown): name is DesignSystemName {
  return typeof name === "string" && (DESIGN_SYSTEMS as readonly string[]).includes(name);
}

export function resolveAppearance(input: AppearanceInput): Appearance {
  const designSystem = isDesignSystem(input.viewerDesignSystem)
    ? input.viewerDesignSystem
    : isDesignSystem(input.pageDesignSystem)
      ? input.pageDesignSystem
      : DEFAULT_DESIGN_SYSTEM;
  const dark = typeof input.viewerDark === "boolean" ? input.viewerDark : input.systemDark === true;
  return { designSystem, dark };
}

export function designSystemHref(origin: string, name: DesignSystemName): string {
  return `${origin.replace(/\/+$/, "")}${AF_DESIGN_SYSTEM_PATH}${name}.css`;
}

export function htmlAttributes(appearance: Appearance): Record<string, string | null> {
  return {
    [AF_DESIGN_SYSTEM_ATTRIBUTE]: appearance.designSystem,
    [AF_DARK_ATTRIBUTE]: appearance.dark ? "true" : null,
  };
}

export function importMap(urls: { apollo: string }): { imports: Record<string, string> } {
  return { imports: { "@afbin/apollo": urls.apollo } };
}

/** Query parameters a screenshot or preview uses to force an appearance: `?af-dark=1&af-design-system=dossier`. */
export const PREVIEW_DARK_PARAMETER = "af-dark";
export const PREVIEW_DESIGN_SYSTEM_PARAMETER = "af-design-system";

/** The appearance a page URL's query forces; null fields force nothing. Unknown values are ignored. */
export function previewOverride(search: string): { designSystem: DesignSystemName | null; dark: boolean | null } {
  const query = new URLSearchParams(search);
  const dark = query.get(PREVIEW_DARK_PARAMETER);
  const designSystem = query.get(PREVIEW_DESIGN_SYSTEM_PARAMETER);
  return {
    designSystem: isDesignSystem(designSystem) ? designSystem : null,
    dark: dark === "1" ? true : dark === "0" ? false : null,
  };
}

/** The viewer's picks with a preview override on top: the override beats the viewer and the page. */
export function withPreview(
  viewer: { designSystem: string | null; dark: boolean | null },
  preview: { designSystem: DesignSystemName | null; dark: boolean | null },
): { designSystem: string | null; dark: boolean | null } {
  return {
    designSystem: preview.designSystem ?? viewer.designSystem,
    dark: preview.dark ?? viewer.dark,
  };
}

const appearance: AppearanceModule = { resolveAppearance, designSystemHref, htmlAttributes, importMap };
export default appearance;
