/**
 * The image-variant contract shared by the run recorder and the report renderer
 * (`evals/lib/report.ts`). Ported from minusx `test/qa/image-variants.ts`.
 *
 * A report's image rows are toggleable — size (mobile vs laptop) and renderer
 * (Playwright's element screenshot vs the app's OWN capture, `/a/<id>/export`).
 * Those are properties of the CAPTURE, and the report is generated after the
 * run is over, so the toggle can only switch between images that already
 * exist: the recorder captures the matrix and the renderer picks one. That is
 * why this is a contract module rather than an option on either side.
 *
 * Dependency-free on purpose — the report CLI runs under plain `tsx` and must
 * not pull Playwright in through a transitive import.
 */

export const IMAGE_SIZES = ['laptop', 'mobile'] as const;
export type ImageSize = (typeof IMAGE_SIZES)[number];

/** `playwright` = element screenshot of the served document; `export` = the product's own `/export` PNG. */
export const IMAGE_RENDERERS = ['playwright', 'export'] as const;
export type ImageRenderer = (typeof IMAGE_RENDERERS)[number];

export interface ImageVariant {
  size: ImageSize;
  renderer: ImageRenderer;
}

/** What a report shows before anyone touches the settings, and what an image row with NO recorded variant reads as. */
export const DEFAULT_IMAGE_VARIANT: ImageVariant = { size: 'laptop', renderer: 'playwright' };

/**
 * Viewport width per size — a layout input, not an output scale. `laptop` is
 * 1280; `mobile` is 390 (iPhone-class CSS width). The served document is
 * captured chrome-free (`?chrome=0`) so the document itself gets the width.
 */
export const VIEWPORT_WIDTH_PX: Record<ImageSize, number> = { laptop: 1280, mobile: 390 };

/** Stable key for one variant — the key of an `ImageSet` in the merged report. */
export function variantKey(variant: ImageVariant): string {
  return `${variant.size}:${variant.renderer}`;
}

/** Human label for the settings UI and the fallback note. */
export function variantLabel(variant: ImageVariant): string {
  return `${variant.size === 'laptop' ? 'Laptop' : 'Mobile'} · ${variant.renderer === 'playwright' ? 'Playwright image' : 'App export'}`;
}

/** Every variant, in display order. */
export function allVariants(): ImageVariant[] {
  return IMAGE_SIZES.flatMap((size) => IMAGE_RENDERERS.map((renderer) => ({ size, renderer })));
}
