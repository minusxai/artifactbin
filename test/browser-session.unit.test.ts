import test from "node:test";
import assert from "node:assert/strict";
import {
  cookieToken,
  sameOrigin,
  requestOrigin,
  setBrowserCookie,
} from "../src/server/browser-session.ts";
import type { BrowserRequest } from "../src/server/browser-session.ts";
const request = (
  headers: Record<string, string>,
  encrypted = false,
  pagegiOrigin?: string,
): BrowserRequest => ({ headers, socket: { encrypted }, pagegiOrigin });
test("browser session cookies use server origin and scoped secure HttpOnly attributes", () => {
  const req = request(
    {
      host: "internal.example",
      cookie: "other=x; pagegi_account=abc_-123; ignored=y",
    },
    false,
    "https://public.example",
  );
  assert.equal(cookieToken(req), "abc_-123");
  assert.equal(requestOrigin(req), "https://public.example");
  let cookie = "";
  const response = {
    setHeader: (_key: string, value: any) => {
      cookie = String(value);
      return response;
    },
  };
  setBrowserCookie(req, response as any, "token");
  assert.match(cookie, /HttpOnly; SameSite=Strict; Path=\//);
  assert.match(cookie, /; Secure$/);
  setBrowserCookie(req, response as any, "");
  assert.match(cookie, /Max-Age=0/);
});
test("browser mutations require exact origin and missing cookies never invent credentials", () => {
  const req = request({
    host: "127.0.0.1:9999",
    origin: "http://127.0.0.1:9999",
  });
  sameOrigin(req);
  assert.equal(cookieToken(req), "");
  assert.throws(
    () =>
      sameOrigin(
        request({ host: "127.0.0.1:9999", origin: "https://other.example" }),
      ),
    (e: any) => e.status === 403,
  );
  assert.throws(
    () => sameOrigin(request({ host: "127.0.0.1:9999" })),
    (e: any) => e.status === 403,
  );
});
