import type { IncomingHttpHeaders, ServerResponse } from "node:http";
import { fail } from "../errors.ts";
export const browserCookie = "pagegi_account";
export interface BrowserRequest {
  headers: IncomingHttpHeaders;
  method?: string;
  socket: object;
  pagegiOrigin?: string;
}
export function requestOrigin(req: BrowserRequest): string {
  return (
    req.pagegiOrigin ||
    `${"encrypted" in req.socket && req.socket.encrypted ? "https" : "http"}://${req.headers.host}`
  );
}
export function sameOrigin(req: BrowserRequest): void {
  if (req.headers.origin !== requestOrigin(req))
    fail(403, "Open this action from Pagegi.");
}
export function cookieToken(req: BrowserRequest): string {
  return (
    /(?:^|;\s*)pagegi_account=([A-Za-z0-9_-]+)/.exec(
      req.headers.cookie || "",
    )?.[1] || ""
  );
}
export function setBrowserCookie(
  req: BrowserRequest,
  res: Pick<ServerResponse, "setHeader">,
  value: string,
): void {
  res.setHeader(
    "Set-Cookie",
    `${browserCookie}=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${value ? 2592000 : 0}${requestOrigin(req).startsWith("https:") ? "; Secure" : ""}`,
  );
}
