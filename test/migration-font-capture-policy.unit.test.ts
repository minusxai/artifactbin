import { test } from "node:test";
import assert from "node:assert/strict";
import {
  fontCaptureAddress,
  isPublicFontAddress,
} from "../src/migration/conversion/compiled/fonts/capture-policy.ts";
test("capture admits only exact HTTPS provider routes and WOFF2 resource paths", () => {
  assert.equal(
    fontCaptureAddress(
      "https://fonts.googleapis.com/css2?family=Example:wght@400",
      "stylesheet",
    ).hostname,
    "fonts.googleapis.com",
  );
  assert.equal(
    fontCaptureAddress(
      "https://fonts.gstatic.com/s/example/v123/Abc_def-09.woff2",
      "font",
    ).hostname,
    "fonts.gstatic.com",
  );
  for (const url of [
    "http://fonts.gstatic.com/s/example/v1/a.woff2",
    "https://fonts.gstatic.com:443/s/example/v1/a.woff2",
    "https://u@fonts.gstatic.com/s/example/v1/a.woff2",
    "https://fonts.gstatic.com/s/example/v1/a.woff2?x=1",
    "https://fonts.gstatic.com/s/example/v1/a.woff2#x",
    "https://fonts.gstatic.com/s/example/../v1/a.woff2",
    "https://fonts.gstatic.com/s/example/v1/a.woff",
    "https://fonts.gstatic.com/s/example/v1/a%2ewoff2",
    "https://fonts.gstatic.com.evil.test/s/example/v1/a.woff2",
    "https://127.0.0.1/s/example/v1/a.woff2",
  ])
    assert.throws(() => fontCaptureAddress(url, "font"));
});
test("capture DNS policy excludes local, mapped, reserved and transition addresses", () => {
  for (const ip of [
    "127.0.0.1",
    "10.0.0.1",
    "172.16.0.1",
    "192.168.0.1",
    "169.254.169.254",
    "0.0.0.0",
    "100.64.0.1",
    "198.18.0.1",
    "192.0.2.1",
    "224.1.1.1",
    "::1",
    "::ffff:127.0.0.1",
    "fc00::1",
    "fe80::1",
    "ff02::1",
    "2001:db8::1",
    "2002:7f00::1",
    "not-an-ip",
  ])
    assert.equal(isPublicFontAddress(ip), false, ip);
  assert.equal(isPublicFontAddress("142.250.1.1"), true);
  assert.equal(isPublicFontAddress("2607:f8b0:4000::1"), true);
});
