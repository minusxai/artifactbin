import { testDatabase } from "./postgres.js";
import { createService } from "../src/server.js";
import { chromium, firefox, webkit } from "playwright";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
const engine = process.argv[2] || "chromium";
const UNREACHABLE = "Could not reach artifactbin. Check your connection and try again.";
const htmlError = (route) =>
  route.fulfill({ status: 502, contentType: "text/html", body: "<html>502</html>" });
const target = process.env.PAGEGI_TEST_ORIGIN;
const identity = target
  ? JSON.parse(readFileSync(process.env.PAGEGI_TEST_ACCOUNTS, "utf8"))[0]
  : null;
const username = identity?.username || "library@example.com";
const db = target ? null : await testDatabase();
let code, service;
if (!target) {
  service = createService({
    ...db,
    secretsKey: new Uint8Array(32).fill(7),
    allowPasswordLogin: false,
    sendCode: async (m) => {
      code = m.code;
    },
  });
  await new Promise((r) => service.server.listen(0, "127.0.0.1", r));
}
const origin = target || `http://127.0.0.1:${service.server.address().port}`;
const dir = mkdtempSync(join(tmpdir(), "pagegi-library-"));
const browser = await { chromium, firefox, webkit }[engine].launch({
  ...(target && process.env.PAGEGI_TEST_ADDRESS
    ? {
        args: [
          `--host-resolver-rules=MAP ${new URL(origin).hostname} ${process.env.PAGEGI_TEST_ADDRESS}`,
        ],
      }
    : {}),
});
try {
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();
  let hostedResponse;
  page.on("response", (r) => {
    if (
      r.request().isNavigationRequest() && /\/a\/[A-Za-z0-9]{6}/.test(new URL(r.url()).pathname)
    )
      hostedResponse = r.text().catch(() => null);
  });
  page.setDefaultTimeout(15000);
  page.on("dialog", (d) => d.accept());
  // A browser that still holds an (expired) account cookie asks the server who it is;
  // one that holds none is signed out without asking.
  await context.addCookies([{ name: "pagegi_account", value: "expired", url: origin }]);
  // A reverse proxy's HTML error page reads as one plain sentence, never a JSON parse error.
  await page.route(/\/api\/library(?:\/profile)?$/, htmlError);
  await page.goto(origin + "/?account=1");
  await page.getByRole("button", { name: "Try again", exact: true }).waitFor();
  assert.equal(await page.locator("#status").textContent(), UNREACHABLE);
  assert.equal(
    await page.locator("#welcome").isVisible(),
    false,
    "Network failure is not a signed-out session",
  );
  await page.unroute(/\/api\/library(?:\/profile)?$/);
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await page
    .getByRole("button", { name: "Sign in with your email", exact: true })
    .waitFor();
  assert.equal(await page.locator("#status").textContent(), "", "a retry that works clears the error");
  // Sent here from a page that needs sign-in: one line says why.
  const nextNote = "Sign in to open the page you were sent to.";
  await page.goto(origin + "/?next=" + encodeURIComponent("/a/AbCdEf"));
  await page.locator("#welcome").getByText(nextNote, { exact: true }).waitFor();
  await page.goto(origin);
  await page.locator("#welcome").waitFor();
  assert.equal(await page.getByText(nextNote).isVisible(), false);
  // Signed out, the home page says what Pagegi does and hands the person's coding
  // agent the instructions to install the skill and publish here.
  const welcome = page.locator("#welcome");
  const welcomeHandoff = await welcome
    .getByRole("textbox", { name: "Agent instructions" })
    .inputValue();
  assert.ok(welcomeHandoff.includes("npx " + origin + "/skills/artefactbin-skill.tgz"));
  assert.ok(welcomeHandoff.includes("--origin " + origin));
  assert.equal(
    await welcome
      .getByRole("link", { name: "Developer? Install the skill", exact: true })
      .getAttribute("href"),
    "/skills/artefactbin-skill.tgz",
  );
  await welcome.getByText("Works with Claude Code, Codex, Pi and OpenCode").waitFor();
  assert.equal(
    await welcome
      .getByRole("link", { name: "Try a local example", exact: true })
      .getAttribute("href"),
    "/example.html",
  );
  await page.evaluate(() => {
    window.__welcomeCopied = [];
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (text) => void window.__welcomeCopied.push(text) },
    });
  });
  await welcome
    .getByRole("button", { name: "Copy agent instructions", exact: true })
    .click();
  await welcome
    .getByRole("button", { name: "Copied — paste into your agent", exact: true })
    .waitFor();
  assert.deepEqual(await page.evaluate(() => window.__welcomeCopied), [welcomeHandoff]);
  assert.equal(
    await page
      .locator("nav.pg-bar")
      .evaluate((el) => el.getBoundingClientRect().height),
    44,
  );
  assert.equal(
    await page
      .locator("html")
      .evaluate((el) =>
        getComputedStyle(el).getPropertyValue("--pg-accent").trim(),
      ),
    "#0e9d4f",
  );
  await page.screenshot({
    path: `test-output/home-${engine}.png`,
    fullPage: true,
  });
  await page
    .locator("#welcome")
    .getByRole("button", { name: "Sign in with your email", exact: true })
    .click();
  await page.getByRole("dialog", { name: "Log in to artifactbin" }).waitFor();
  await page.getByRole("button", { name: "Close sign-in" }).click();
  await page
    .locator("nav.pg-bar")
    .getByRole("button", { name: "Sign in", exact: true })
    .click();
  if (identity) {
    await page.getByRole("button", { name: "Close sign-in" }).click();
    await context.addCookies([
      {
        name: "pagegi_account",
        value: identity.token,
        url: origin,
        httpOnly: true,
        secure: true,
        sameSite: "Strict",
      },
    ]);
    await page.reload();
  } else {
    await page.getByLabel("Email address").fill("library@example.com");
    await page.getByRole("button", { name: "Log in with email", exact: true }).click();
    await page.getByLabel("Email code").waitFor();
    await page.getByLabel("Email code").fill(code);
    await page.route("**/api/auth/email/verify", htmlError, { times: 1 });
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Log in", exact: true })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("alert")
      .getByText(UNREACHABLE, { exact: true })
      .waitFor();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Log in", exact: true })
      .click();
  }
  await page
    .getByRole("heading", { name: "Artifacts", exact: true })
    .waitFor();
  assert.equal(await page.locator("#workspace-nav").isVisible(), true);
  assert.equal(await page.locator("#workspace-artifacts").getAttribute("aria-current"), "page");
  let releaseSession;
  const sessionGate = new Promise((resolve) => {
    releaseSession = resolve;
  });
  await page.route("**/api/library", async (route) => {
    await sessionGate;
    await route.continue();
  });
  await page.reload();
  assert.equal(
    await page.locator("#welcome").isVisible(),
    false,
    "No signed-out homepage flash",
  );
  assert.equal(
    await page.locator("#library").isVisible(),
    false,
    "No personal content before session resolves",
  );
  releaseSession();
  await page.locator("#library").waitFor();
  await page.unroute("**/api/library");

  await page
    .getByRole("heading", { name: "Artifacts", exact: true })
    .waitFor();
  let releaseProfile;
  const profileGate = new Promise((resolve) => {
    releaseProfile = resolve;
  });
  await page.route("**/api/library/profile", async (route) => {
    await profileGate;
    await route.continue();
  });
  await page.goto(origin + "/?account=1");
  assert.equal(await page.locator("#welcome").isVisible(), false);
  assert.equal(await page.locator("#library").isVisible(), false);
  assert.equal(await page.locator("#account-page").isVisible(), false);
  releaseProfile();
  await page.getByLabel("Display name", { exact: true }).waitFor();
  await page.unroute("**/api/library/profile");
  assert.equal(await page.locator("#library").isVisible(), false);
  await page.getByRole("link", { name: "Artifacts", exact: true }).click();
  await page.getByRole("button", { name: "Account menu", exact: true }).click();
  await page
    .getByRole("link", { name: "Account & profile", exact: true })
    .click();
  const accountFrame = page.frameLocator('iframe[title="Account settings"]');
  assert.equal(page.url(), origin + "/");
  await accountFrame.getByLabel("Display name", { exact: true }).fill("   ");
  await accountFrame
    .getByRole("button", { name: "Save profile", exact: true })
    .click();
  await accountFrame.getByText("Enter a display name.", { exact: true }).waitFor();
  await accountFrame
    .getByLabel("Display name", { exact: true })
    .fill("Library reviewer");
  await accountFrame
    .getByLabel("Profile photo", { exact: true })
    .setInputFiles({
      name: "avatar.png",
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAZ0lEQVR4nGPwiK2lKWIYtWDUAhi68+wrJqKaBVhNJ9IOwhbgMZ0YO0YtGLWAHhbgt4Og3sGRkylBI8QCGkYywTRK0Bp8FhBpOn47cFpAkul47BggC8gwHZcdA2EB2aZjtWPUgoG3AAC/n4daYjDScAAAAABJRU5ErkJggg==",
        "base64",
      ),
    });
  await accountFrame.locator("#profile-preview").waitFor({ state: "visible" });
  await accountFrame
    .getByRole("button", { name: "Save profile", exact: true })
    .click();
  await accountFrame.getByText("Profile saved.", { exact: true }).waitFor();
  // The handle: none at first, a refused one explained, saved lowercase with the
  // address it gives, then removed so a shared server keeps no state from this run.
  const handleSection = accountFrame.getByRole("region", { name: "Handle" });
  const handleField = handleSection.getByLabel("Handle", { exact: true });
  const chosen = `journey-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  // A shared server's account may keep a handle from a run that stopped midway.
  if (target && (await handleField.inputValue())) {
    await handleSection.getByRole("button", { name: "Remove handle", exact: true }).click();
    await handleSection.getByText("Handle removed.", { exact: true }).waitFor();
  }
  assert.equal(await handleField.inputValue(), "", "a new account has no handle");
  assert.equal(await handleSection.getByRole("button", { name: "Remove handle", exact: true }).isVisible(), false);
  await handleField.fill("no--good");
  await handleSection.getByRole("button", { name: "Save handle", exact: true }).click();
  await handleSection.getByRole("alert").filter({ hasText: /hyphens/ }).waitFor();
  await handleField.fill(chosen.toUpperCase());
  await handleSection.getByRole("button", { name: "Save handle", exact: true }).click();
  await handleSection.getByText("Handle saved.", { exact: true }).waitFor();
  assert.equal(await handleField.inputValue(), chosen, "saved lowercase");
  assert.equal(await handleSection.getByRole("alert").innerText(), "");
  await handleSection.getByText(`${origin}/@${chosen}/<path>`, { exact: true }).waitFor();
  assert.ok(!(await handleSection.innerText()).includes(username), "the address never shows the email");
  await handleSection.getByRole("button", { name: "Remove handle", exact: true }).click();
  await handleSection.getByText("Handle removed.", { exact: true }).waitFor();
  assert.equal(await handleField.inputValue(), "");
  assert.equal(await handleSection.getByText(`/@${chosen}/`).count(), 0);
  // Account secrets: add one, see it listed by name only, remove it with confirmation.
  const secrets = accountFrame.getByRole("region", { name: "Secrets" });
  if (await secrets.getByText("Secrets are not configured").isVisible()) {
    assert.ok(target, "a local server runs with a secrets key");
  } else {
    await secrets.getByText("No secrets yet.", { exact: true }).waitFor();
    await secrets.getByLabel("Secret name", { exact: true }).fill("stripe key");
    await secrets.getByLabel("Secret value", { exact: true }).fill("sk_live_journey");
    await secrets.getByRole("button", { name: "Add secret", exact: true }).click();
    await secrets.getByRole("alert").filter({ hasText: /name/i }).waitFor();
    await secrets.getByLabel("Secret name", { exact: true }).fill("STRIPE_KEY");
    await secrets.getByRole("button", { name: "Add secret", exact: true }).click();
    const row = secrets.getByRole("listitem").filter({ hasText: "STRIPE_KEY" });
    await row.waitFor();
    await row.getByText(/^set /).waitFor();
    assert.equal(await secrets.getByLabel("Secret value", { exact: true }).inputValue(), "", "the value field is cleared once saved");
    assert.equal(await secrets.getByRole("alert").innerText(), "");
    assert.ok(!(await accountFrame.locator("body").innerHTML()).includes("sk_live_journey"), "the value is never shown after saving");
    assert.equal(await secrets.getByRole("listitem").count(), 1);
    await row.getByRole("button", { name: "Remove STRIPE_KEY", exact: true }).click();
    await secrets.getByText("No secrets yet.", { exact: true }).waitFor();
    assert.equal(await secrets.getByRole("listitem").count(), 0);
  }
  await page.screenshot({
    path: `test-output/account-${engine}.png`,
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page.screenshot({
    path: `test-output/account-mobile-${engine}.png`,
    fullPage: true,
  });
  await page.setViewportSize({ width: 1280, height: 720 });

  await accountFrame
    .getByRole("button", { name: "Dark mode", exact: true })
    .click();
  assert.equal(
    await accountFrame.locator("html").getAttribute("data-theme"),
    "dark",
  );
  await page
    .getByRole("button", { name: "Close account", exact: true })
    .click();
  await page.reload();
  await page.locator("#account-menu img").waitFor();
  // The empty library hands the person to their coding agent: tokenless text
  // naming this server, its skill installer and server origin, copied to the clipboard.
  await page.evaluate(() => {
    window.__copied = [];
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text) => {
          if (window.__copyFails) throw Error("denied");
          window.__copied.push(text);
        },
      },
    });
  });
  const agentDialog = page.getByRole("dialog", {
    name: "Build a page with your coding agent",
  });
  await page
    .getByRole("button", { name: "Build one with your agent", exact: true })
    .click();
  await agentDialog.waitFor();
  const instructions = agentDialog.getByRole("textbox", {
    name: "Agent instructions",
  });
  const handoff = await instructions.inputValue();
  assert.ok(handoff.includes("npx " + origin + "/skills/artefactbin-skill.tgz"));
  assert.ok(handoff.includes("--origin " + origin), "a test server is not the skill's default");
  assert.ok(handoff.includes("--email " + username));
  const accountCookie = (await context.cookies()).find(
    (c) => c.name === "pagegi_account",
  );
  assert.ok(accountCookie && !handoff.includes(accountCookie.value));
  await agentDialog
    .getByRole("button", { name: "Copy agent instructions", exact: true })
    .click();
  await agentDialog
    .getByRole("button", { name: "Copied — paste into your agent", exact: true })
    .waitFor();
  assert.deepEqual(await page.evaluate(() => window.__copied), [handoff]);
  assert.equal(
    await agentDialog
      .getByRole("link", { name: "Download the installer", exact: true })
      .getAttribute("href"),
    "/skills/artefactbin-skill.tgz",
  );
  await page.keyboard.press("Escape");
  await agentDialog.waitFor({ state: "hidden" });
  await page.evaluate(() => {
    window.__copyFails = true;
  });
  await page.getByRole("button", { name: "Create artifact", exact: true }).click();
  await agentDialog
    .getByRole("button", { name: "Copy agent instructions", exact: true })
    .click();
  await agentDialog
    .getByText("Could not copy. Select and copy the text above.", { exact: true })
    .waitFor();
  await agentDialog
    .getByRole("button", { name: "Close agent instructions", exact: true })
    .click();
  await agentDialog.waitFor({ state: "hidden" });
  // An empty library is the empty-state card alone: no search strip, no column header.
  assert.equal(await page.locator("#library-toolbar").isVisible(), false);
  assert.equal(await page.locator("#list-heading").isVisible(), false);
  assert.ok(
    await page.evaluate(() => {
      const after = (a, b) =>
        Boolean(
          document.getElementById(a).compareDocumentPosition(document.getElementById(b)) &
            Node.DOCUMENT_POSITION_FOLLOWING,
        );
      return (
        after("empty", "shared-documents") &&
        after("library", "public-documents") &&
        after("welcome", "public-documents")
      );
    }),
    "Shared with you follows the empty state; public documents follow the library",
  );
  // A folder address that does not exist says so, with a way back.
  await page.goto(origin + "/?folder=" + encodeURIComponent("/Nope"));
  await page
    .getByRole("heading", { name: "This folder does not exist.", exact: true })
    .waitFor();
  assert.equal(
    await page.getByRole("button", { name: "New example", exact: true }).isVisible(),
    false,
  );
  await page.getByRole("link", { name: "Back to Documents", exact: true }).click();
  await page
    .getByRole("button", { name: "Start with an example", exact: true })
    .click();
  await page.waitForURL("**/a/**");
  const app = page.frameLocator("#pg-frame");
  assert.equal(
    await page
      .getByRole("button", { name: /^(Comment|Sync|Inspect|Me|Save file)$/ })
      .count(),
    0,
  );
  await page.locator("#pg-me img").waitFor();
  const ownTab = await context.newPage();
  ownTab.on("dialog", (d) => d.accept());
  await ownTab.goto(page.url());
  await ownTab
    .frameLocator("#pg-frame")
    .getByRole("button", { name: "Add", exact: true })
    .waitFor();
  await ownTab
    .frameLocator("#pg-frame")
    .getByRole("button", { name: "Add", exact: true })
    .hover();
  assert.equal(
    await page
      .getByRole("button", {
        name: "View " + username + "'s snapshot",
        exact: true,
      })
      .count(),
    0,
  );
  assert.equal(
    await ownTab
      .getByRole("button", {
        name: "View " + username + "'s snapshot",
        exact: true,
      })
      .count(),
    0,
  );
  await ownTab.waitForFunction(
    () => window.pagegi?.getStatus().sync === "synced",
  );
  assert.equal(await ownTab.locator("#pg-people").isVisible(), false);
  await ownTab.close();

  const accountButton = page.getByRole("button", {
    name: "Account menu",
    exact: true,
  });
  await page.evaluate(() => {
    window.menuTrace = [
      {
        type: "initial",
        expanded: document
          .querySelector("#pg-me")
          .getAttribute("aria-expanded"),
        focused: document.hasFocus(),
      },
    ];
    for (const type of [
      "pointerdown",
      "pointerup",
      "click",
      "dblclick",
      "focus",
      "blur",
    ])
      addEventListener(
        type,
        (event) => {
          menuTrace.push({
            type,
            target: event.target?.id,
            tag: event.target?.tagName,
            detail: event.detail,
            expanded: document
              .querySelector("#pg-me")
              .getAttribute("aria-expanded"),
            focused: document.hasFocus(),
            at: performance.now(),
          });
        },
        true,
      );
    new MutationObserver(() =>
      menuTrace.push({
        type: "attribute",
        expanded: document
          .querySelector("#pg-me")
          .getAttribute("aria-expanded"),
        at: performance.now(),
      }),
    ).observe(document.querySelector("#pg-me"), {
      attributes: true,
      attributeFilter: ["aria-expanded"],
    });
  });
  async function accountState(expected) {
    try {
      await page.waitForFunction(
        (expected) =>
          document.querySelector("#pg-me").getAttribute("aria-expanded") ===
          expected,
        expected,
      );
      assert.equal(await accountButton.getAttribute("aria-expanded"), expected);
    } catch (error) {
      const trace = await page.evaluate(() => window.menuTrace);
      console.error("Account toggle trace", JSON.stringify(trace));
      const dir =
        process.env.PAGEGI_BROWSER_DIAGNOSTICS_DIR ||
        "/tmp/pagegi-browser-diagnostics";
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, `library-menu-${engine}.json`),
        JSON.stringify(trace, null, 2),
      );
      await page.screenshot({ path: join(dir, `library-menu-${engine}.png`) });
      throw error;
    }
  }
  await accountButton.click();
  await accountState("true");
  assert.equal(
    await page.getByRole("button", { name: "Close", exact: true }).count(),
    0,
  );
  await accountButton.click();
  await accountState("false");
  await accountButton.click();
  await accountState("true");
  await page.keyboard.press("Escape");
  await accountState("false");
  await accountButton.click();
  await page.getByRole("button", { name: "Close panel", exact: true }).click();
  await page.waitForFunction(
    () =>
      document.querySelector("#pg-me").getAttribute("aria-expanded") ===
      "false",
  );

  await page.getByRole("button", { name: "Account menu", exact: true }).click();
  const hostedAccountURL = page.url();
  await page
    .getByRole("button", { name: "Account & profile", exact: true })
    .click();
  const accountPage = page.frameLocator('iframe[title="Account settings"]');
  assert.equal(page.url(), hostedAccountURL);
  await accountPage.getByLabel("Display name", { exact: true }).waitFor();
  assert.equal(
    await accountPage.getByLabel("Display name", { exact: true }).inputValue(),
    "Library reviewer",
  );
  assert.equal(await accountPage.locator("#library").isVisible(), false);
  assert.equal(await accountPage.locator("#welcome").isVisible(), false);
  await page
    .getByRole("button", { name: "Close account", exact: true })
    .click();

  await page
    .getByRole("button", { name: "Page settings", exact: true })
    .click();
  await page.getByRole("button", { name: "Dark mode", exact: true }).click();
  assert.equal(await page.locator("html").getAttribute("data-theme"), "dark");
  await page.getByRole("button", { name: "Light mode", exact: true }).click();
  await app.locator("html:not([data-af-dark])").waitFor();
  await page.screenshot({
    path: `test-output/account-menu-${engine}.png`,
    fullPage: true,
  });

  await page
    .getByRole("button", { name: "Page settings", exact: true })
    .click();

  await app
    .getByRole("button", { name: "Add", exact: true })
    .press("Shift+F10");
  await page
    .getByRole("menuitem", { name: "Add comment", exact: true })
    .waitFor();
  await page
    .getByRole("menuitem", { name: "Add comment", exact: true })
    .press("Escape");
  assert.equal(
    await page
      .getByRole("menuitem", { name: "Add comment", exact: true })
      .isVisible(),
    false,
  );
  // No backend runs on this server, so the shared list is offline; the draft is the viewer's own local state.
  await app.getByPlaceholder("Add a task").fill("Milk");
  await app.getByText("Offline: showing the list as you last saw it.").waitFor();
  await app
    .getByRole("heading", { name: "Team todo list", exact: true })
    .click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "Add comment", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Comment text" })
    .fill("A comment from my library");
  await page.getByRole("button", { name: "Post comment", exact: true }).click();
  await page.locator('.pg-message[data-sync="saved"]').waitFor();
  await page
    .getByRole("textbox", { name: "Reply to comment", exact: true })
    .fill("A reply in the same thread");
  await page.getByRole("button", { name: "Reply", exact: true }).click();
  await page.getByText("A reply in the same thread", { exact: true }).waitFor();
  await page.locator('.pg-message[data-sync="saved"]').nth(1).waitFor();

  await page.locator(".pg-pin img").waitFor({ state: "attached" });
  await page.waitForFunction(() => {
    const pin = document.querySelector(".pg-pin");
    if (!pin) return false;
    const rect = pin.getBoundingClientRect();
    return rect.width > 0 && rect.x > innerWidth - 80;
  });
  await page.screenshot({
    path: `test-output/document-light-${engine}.png`,
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Page settings", exact: true })
    .click();
  await page.getByRole("button", { name: "Dark mode", exact: true }).click();
  await page
    .getByRole("button", { name: "Page settings", exact: true })
    .click();
  await page.screenshot({
    path: `test-output/document-dark-${engine}.png`,
    fullPage: true,
  });

  const shell = JSON.parse(
    /<script id="pagegi-host" type="application\/json">([\s\S]*?)<\/script>/.exec(
      await hostedResponse,
    )[1],
  );
  // The page grant the hosted view was issued.
  const { boot } = await page.evaluate(
    (url) => fetch(url, { credentials: "same-origin" }).then((r) => r.json()),
    shell.stateUrl,
  );
  assert.equal(typeof boot.token, "string");
  const savedDownload = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Page settings", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Download HTML", exact: true })
    .click();
  const savedPath = join(dir, "hosted-save.html");
  await (await savedDownload).saveAs(savedPath);
  assert.ok(
    !readFileSync(savedPath, "utf8").includes(boot.token),
    "Scoped host session excluded from Save file",
  );
  await page.getByRole("button", { name: "Artifacts", exact: true }).click();
  await page.getByText("2 comments", { exact: true }).waitFor();
  const downloadEvents = [];
  const downloadStarted = Date.now();
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.endsWith("/download"))
      downloadEvents.push({
        event: "request",
        elapsed: Date.now() - downloadStarted,
      });
  });
  page.on("response", (response) => {
    if (new URL(response.url()).pathname.endsWith("/download"))
      downloadEvents.push({
        event: "response",
        elapsed: Date.now() - downloadStarted,
        status: response.status(),
      });
  });
  page.on("requestfailed", (request) => {
    if (new URL(request.url()).pathname.endsWith("/download"))
      downloadEvents.push({
        event: "failed",
        elapsed: Date.now() - downloadStarted,
        error: request.failure(),
      });
  });
  await page.evaluate(() => {
    window.__downloadEvents = [];
    const started = performance.now();
    const record = (event) =>
      window.__downloadEvents.push({
        event,
        elapsed: performance.now() - started,
      });
    const create = URL.createObjectURL,
      revoke = URL.revokeObjectURL,
      click = HTMLAnchorElement.prototype.click;
    URL.createObjectURL = function (...args) {
      record("blob-created");
      return create.apply(this, args);
    };
    URL.revokeObjectURL = function (...args) {
      record("blob-revoked");
      return revoke.apply(this, args);
    };
    HTMLAnchorElement.prototype.click = function () {
      record("anchor-click-connected:" + this.isConnected);
      return click.call(this);
    };
  });
  const file = join(dir, "download.html");
  try {
    const download = page.waitForEvent("download");
    await Promise.all([
      download.then(async (event) => {
        downloadEvents.push({
          event: "download",
          elapsed: Date.now() - downloadStarted,
        });
        await event.saveAs(file);
      }),
      (async () => {
        await page.locator(".row-menu summary").first().click();
        downloadEvents.push({
          event: "menu-open",
          elapsed: Date.now() - downloadStarted,
        });
        await page
          .getByRole("button", { name: "Download", exact: true })
          .click();
        downloadEvents.push({
          event: "download-click-complete",
          elapsed: Date.now() - downloadStarted,
        });
      })(),
    ]);
  } catch (error) {
    const diagnostics = {
      events: downloadEvents,
      browser: await page.evaluate(() => window.__downloadEvents),
      status: await page.locator("#status").textContent(),
      url: new URL(page.url()).pathname,
    };
    console.error("Library download diagnostics", diagnostics);
    const diagnosticDir =
      process.env.PAGEGI_BROWSER_DIAGNOSTICS_DIR ||
      "/tmp/pagegi-browser-diagnostics";
    mkdirSync(diagnosticDir, { recursive: true });
    writeFileSync(
      join(diagnosticDir, `library-download-${engine}.json`),
      JSON.stringify(diagnostics, null, 2),
    );
    await page.screenshot({
      path: join(diagnosticDir, `library-download-${engine}.png`),
    });
    throw error;
  }
  const content = readFileSync(file, "utf8");
  const cookies = await page.context().cookies();
  const session = cookies.find((c) => c.name === "pagegi_account");
  assert.ok(session.httpOnly);
  assert.ok(!content.includes(session.value));
  assert.ok(!content.includes('id="pagegi-host"'));
  // The downloaded file works on its own; with its server reachable it shows
  // the platform bar and offers Connect. A library download carries the page's
  // starting state; the viewer's own state comes only with a download from the open page.
  const local = await page.context().newPage();
  await local.goto("file://" + file);
  await local.getByRole("heading", { name: "Team todo list", exact: true }).waitFor();
  await local.locator("nav#pg-bar").getByRole("button", { name: "Connect", exact: true }).waitFor();
  await local.close();
  await page.getByLabel("Search artifacts").fill("does not exist");
  await page.getByText("No documents match your search.").waitFor();
  await page.getByLabel("Search artifacts").fill("");
  // Files Publish HTML cannot take are refused in plain words, before any upload.
  for (const [name, body, expected] of [
    ["notes.txt", "just text", "Choose an HTML file (.html or .htm)."],
    ["empty.html", "", "This file is empty. Choose an HTML file with a page in it."],
    [
      "draft #2.html",
      "<h1>Draft</h1>",
      "File and folder names can’t contain “#”. Rename it and try again.",
    ],
  ]) {
    await page.locator("#upload").setInputFiles({
      name,
      mimeType: "text/html",
      buffer: Buffer.from(body),
    });
    await page.locator("#status").getByText(expected, { exact: true }).waitFor();
  }
  await page.getByRole("button", { name: "Publish HTML", exact: true }).click();
  await page.locator("#upload").setInputFiles({
    name: "research.html",
    mimeType: "text/html",
    buffer: Buffer.from(
      '<!doctype html><title>Research notes</title><h1 data-af-id="title">Research</h1>',
    ),
  });
  await page.waitForURL("**/a/**");
  await page
    .frameLocator("#pg-frame")
    .getByRole("heading", { name: "Research", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Artifacts", exact: true }).click();
  await page
    .getByRole("link", { name: "research.html", exact: true })
    .waitFor();
  for (const name of ["research", "2026"]) {
    await page.getByRole("button", { name: "New folder", exact: true }).click();
    await page.getByLabel("Folder name", { exact: true }).fill(name);
    await page
      .getByRole("button", { name: "Create folder", exact: true })
      .click();
    await page.getByRole("link", { name, exact: true }).click();
  }
  // An example made inside a folder is named like the example, as in the root.
  await page
    .getByRole("button", { name: "Start with an example", exact: true })
    .click();
  await page.waitForURL("**/a/**");
  await page.goto(origin + "/?folder=" + encodeURIComponent("/research/2026"));
  await page
    .getByRole("link", { name: "team-todo-list.html", exact: true })
    .waitFor();
  await page.goto(origin);
  await page.locator('[data-path="/research.html"] summary').click();
  await page.getByRole("button", { name: "Rename", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("notes.html");
  await page.getByRole("button", { name: "Save name", exact: true }).click();
  await page.locator('[data-path="/notes.html"] summary').click();
  await page.getByRole("button", { name: "Move to…", exact: true }).click();
  await page.getByRole("treeitem", { name: "▱ 2026", exact: true }).click();
  await page.getByRole("button", { name: "Move here", exact: true }).click();
  await page.getByRole("link", { name: "research", exact: true }).click();
  await page.getByRole("link", { name: "2026", exact: true }).click();
  await page.getByRole("link", { name: "notes.html", exact: true }).click();
  await page.waitForURL((url) => /^\/a\/[A-Za-z0-9]{6}$/.test(url.pathname));
  await page
    .frameLocator("#pg-frame")
    .getByRole("heading", { name: "Research", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Artifacts", exact: true }).click();
  await page.screenshot({
    path: `test-output/library-desktop-${engine}.png`,
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  assert.ok(
    (await page.locator(".file-info").first().boundingBox()).width > 150,
  );
  await page.screenshot({
    path: `test-output/library-${engine}.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "Account menu", exact: true }).click();
  await page
    .getByRole("link", { name: "Account & profile", exact: true })
    .click();
  await accountFrame
    .getByRole("button", { name: "Remove photo", exact: true })
    .click();
  await accountFrame.getByText("Ready to save.", { exact: true }).waitFor();
  await accountFrame
    .getByRole("button", { name: "Save profile", exact: true })
    .click();
  await page.locator("#account-menu img").waitFor({ state: "detached" });
  await accountFrame
    .getByRole("button", { name: "Sign out", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Sign in with your email", exact: true })
    .waitFor();
  await page.reload();
  await page
    .getByRole("button", { name: "Sign in with your email", exact: true })
    .waitFor();
  console.log(
    `${engine}: homepage signup, persistent login, private library, hosted comments, portable download, cookie reuse, publish/search/mobile/logout passed`,
  );
} finally {
  await browser.close();
  if (service) {
    await service.close();
    await new Promise((r) => service.server.close(r));
    await db.cleanup();
  }
  rmSync(dir, { recursive: true, force: true });
}
