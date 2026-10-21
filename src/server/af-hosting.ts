/**
 * Platform files under /af/v1/: the built core, the design systems, and the
 * portable download of a page.
 */
import { readFile } from "node:fs/promises";
import {
  AF_CORE_PATH,
  AF_DESIGN_SYSTEM_PATH,
  DEFAULT_DESIGN_SYSTEM,
  DESIGN_SYSTEMS,
  type DesignSystemName,
} from "../af-contracts.ts";
import type { PageModelModule } from "../page/page-contracts.ts";
import type { AddressedPage } from "./af-pages.ts";
import { fail } from "../errors.ts";

const root = new URL("../../", import.meta.url);
const coreFile = new URL("dist/core.js", root);
const designSystemsDirectory = new URL(
  "skills/pagegi-author/design-systems/",
  root,
);

/** What a hosted page's runner puts in a `data-af="design-system"` link before the core. */
export interface HostedDesignSystem {
  name: DesignSystemName;
  /** `data:text/css;base64,…` of the system's CSS. */
  href: string;
}

export interface AfAsset {
  body: string;
  headers: Record<string, string>;
}

function designSystem(name: string): DesignSystemName | null {
  return (DESIGN_SYSTEMS as readonly string[]).includes(name)
    ? (name as DesignSystemName)
    : null;
}

/** The built core (brief A's dist/core.js); 503 until it is built. */
export async function coreScript(): Promise<string> {
  try {
    return await readFile(coreFile, "utf8");
  } catch (error) {
    if ((error as { code?: string }).code === "ENOENT")
      fail(503, "The core is not built on this server");
    throw error;
  }
}

export function designSystemCss(name: DesignSystemName): Promise<string> {
  return readFile(new URL(`${name}.css`, designSystemsDirectory), "utf8");
}

/** GET /af/v1/core.js and /af/v1/design-systems/<name>.css; null for any other path. */
export async function afAsset(pathname: string): Promise<AfAsset | null> {
  if (pathname === AF_CORE_PATH)
    return {
      body: await coreScript(),
      headers: {
        "Content-Type": "text/javascript; charset=utf-8",
        "Cache-Control": "no-cache",
        "Access-Control-Allow-Origin": "*",
        "Cross-Origin-Resource-Policy": "cross-origin",
      },
    };
  if (pathname.startsWith(AF_DESIGN_SYSTEM_PATH)) {
    const match = /^([a-z]+)\.css$/.exec(
      pathname.slice(AF_DESIGN_SYSTEM_PATH.length),
    );
    const name = match ? designSystem(match[1]!) : null;
    if (!name) return null;
    return {
      body: await designSystemCss(name),
      headers: {
        "Content-Type": "text/css; charset=utf-8",
        "Cache-Control": "no-cache",
        "Access-Control-Allow-Origin": "*",
        "Cross-Origin-Resource-Policy": "cross-origin",
      },
    };
  }
  return null;
}

/** The CSS a hosted page carries inline so its first paint is styled: the page's own design system (default meridian). */
export async function hostedDesignSystem(
  model: PageModelModule,
  source: string,
): Promise<HostedDesignSystem> {
  const name = model.parsePage(source).designSystem ?? DEFAULT_DESIGN_SYSTEM;
  return { name, href: model.designSystemDataUrl(await designSystemCss(name)) };
}

/**
 * A page file that works on its own: core inlined, design system embedded,
 * state kept, and the server (`server`, this server's public origin) and the
 * version's digest recorded on the core tag so the file can reconnect.
 */
export async function portablePage(
  model: PageModelModule,
  page: AddressedPage,
  server?: string,
): Promise<{ html: string; filename: string }> {
  const name = model.parsePage(page.source).designSystem ?? DEFAULT_DESIGN_SYSTEM;
  const html = model.toPortable(page.source, {
    core: await coreScript(),
    designSystem: name,
    designSystemCss: await designSystemCss(name),
    state: page.state ?? {},
    ...(server ? { server, revision: page.revision } : {}),
  });
  const base = page.path.split("/").at(-1) || page.id;
  return { html, filename: /\.html?$/i.test(base) ? base : base + ".html" };
}

export function attachment(filename: string): string {
  const ascii = filename.replace(/[^A-Za-z0-9._-]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
