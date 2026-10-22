import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";
import { compileArchivedLocal } from "../src/migration/conversion/compiled/local.ts";
const root = process.env.PAGEGI_ARCHIVED_COMPILER_ROOT;

test(
  "archived presentation kit keeps keyboard, focus, deferred overlays and styled fallback through compilation",
  { skip: !root },
  async () => {
    const result = await compileArchivedLocal(
      {
        coreUrl: "/af/v1/core.js",
        source: `<Helmet><Value name="count" type="number" default={0}/><Value name="rows" type="table" value={[{key:"a",label:"First"},{key:"b",label:"Second"}]}/></Helmet>
      <p id="count">{$count}</p>
      <Accordion id="accordion" type="single" collapsible>
        <AccordionItem id="item" value="first">
          <AccordionTrigger id="accordion-trigger">Details</AccordionTrigger>
          <AccordionContent id="accordion-content"><p id="detail">Expanded details</p></AccordionContent>
        </AccordionItem>
      </Accordion>
      <TooltipProvider id="tooltip-provider"><Tooltip id="tooltip-root"><TooltipTrigger id="tooltip-trigger">More information</TooltipTrigger><TooltipContent id="tooltip-content"><span id="hint">Helpful text</span></TooltipContent></Tooltip></TooltipProvider>
      <Dialog id="dialog-root"><DialogTrigger id="dialog-trigger">Open settings</DialogTrigger><DialogContent id="dialog-content" aria-labelledby="dialog-title"><h2 id="dialog-title">Settings</h2><input id="first-field" aria-label="Name"/><DialogClose id="dialog-close">Done</DialogClose></DialogContent></Dialog>
      <For id="hints" each={$rows} keyBy="key"><Tooltip id="row-tooltip"><TooltipTrigger id="row-trigger">{$_row.label}</TooltipTrigger><TooltipContent id="row-content">Row help</TooltipContent></Tooltip></For>
      <Avatar id="avatar" className="size-12 rounded-full bg-blue-500"><AvatarFallback id="avatar-fallback" className="font-bold">AB</AvatarFallback></Avatar>`,
      },
      { legacyRoot: root! },
    );
    assert.equal(
      result.classification,
      "functional",
      JSON.stringify(result.issues),
    );
    assert.ok(result.html);
    const core = await readFile(
      new URL("../dist/core.js", import.meta.url),
      "utf8",
    );
    const server = createServer((request, response) => {
      if (request.url === "/af/v1/core.js")
        response
          .writeHead(200, { "content-type": "text/javascript" })
          .end(core);
      else if (request.url === "/proof")
        response
          .writeHead(200, { "content-type": "text/html" })
          .end(result.html);
      else response.writeHead(404).end();
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      page.setDefaultTimeout(15000);
      const errors: string[] = [];
      const external: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("request", (request) => {
        const url = new URL(request.url());
        if (
          ["http:", "https:"].includes(url.protocol) &&
          url.hostname !== "127.0.0.1"
        )
          external.push(url.origin);
      });
      await page.goto(
        `http://127.0.0.1:${(server.address() as { port: number }).port}/proof`,
      );
      await page.locator("html[data-mx-ready]").waitFor();
      const trigger = page.locator("#accordion-trigger");
      await trigger.focus();
      await trigger.press("Enter");
      await page.waitForFunction(
        () =>
          document
            .querySelector("#accordion-trigger")
            ?.getAttribute("aria-expanded") === "true",
      );
      assert.equal(await page.locator("#detail").isVisible(), true);
      assert.equal(
        await page
          .locator("#accordion-content")
          .getAttribute("aria-labelledby"),
        "accordion-trigger",
      );
      await trigger.press("Space");
      await page.waitForFunction(
        () =>
          document
            .querySelector("#accordion-trigger")
            ?.getAttribute("aria-expanded") === "false",
      );
      assert.equal(await page.locator("#accordion-content").isVisible(), false);

      const placedTooltip = async () => {
        await page.locator("#tooltip-content").waitFor({ state: "visible" });
        await page
          .waitForFunction(() => {
            const node = document.querySelector("#tooltip-content");
            const rect = node?.getBoundingClientRect();
            return (
              !!node?.getAttribute("data-side") &&
              !!rect &&
              rect.top >= 0 &&
              rect.left >= 0 &&
              rect.bottom <= innerHeight &&
              rect.right <= innerWidth
            );
          })
          .catch(async () =>
            assert.fail(
              JSON.stringify(
                await page
                  .locator("#tooltip-content")
                  .evaluate((node) => ({
                    rect: node.getBoundingClientRect().toJSON(),
                    side: node.getAttribute("data-side"),
                    parent: node.parentElement?.getAttribute("style"),
                  })),
              ),
            ),
          );
      };
      assert.equal(await page.locator("#tooltip-content").isVisible(), false);
      await page.locator("#tooltip-trigger").focus();
      await page.waitForFunction(
        () => !!document.querySelector("#tooltip-content"),
      );
      await page.waitForFunction(
        () =>
          document
            .querySelector("#tooltip-trigger")
            ?.getAttribute("aria-describedby") === "tooltip-content",
      );
      await placedTooltip();
      assert.equal(await page.locator("#hint").textContent(), "Helpful text");
      assert.equal(
        await page.locator("#tooltip-content").getAttribute("data-af-id"),
        "tooltip-content",
      );
      assert.equal(
        await page.locator("#tooltip-root #tooltip-content").count(),
        0,
      );
      await page.keyboard.press("Escape");
      await page.waitForFunction(
        () => !!document.querySelector("#tooltip-content")?.closest("[hidden]"),
      );
      assert.equal(
        await page.locator("#tooltip-trigger").getAttribute("aria-describedby"),
        null,
      );

      assert.equal(
        await page.locator("#tooltip-root #tooltip-content").count(),
        1,
      );
      await page.locator("#accordion-trigger").focus();
      await page.locator("#tooltip-trigger").hover();
      await placedTooltip();
      assert.equal(
        await page.locator("#tooltip-trigger").getAttribute("aria-describedby"),
        "tooltip-content",
      );
      await page.mouse.move(0, 0);
      await page.waitForFunction(
        () => !!document.querySelector("#tooltip-content")?.closest("[hidden]"),
      );
      await page.locator("#dialog-trigger").click();
      await page.waitForFunction(
        () =>
          document.querySelector<HTMLDialogElement>("#dialog-content")?.open ===
          true,
      );
      await page.waitForFunction(
        () => document.activeElement?.id === "first-field",
      );
      assert.equal(
        await page.locator("#dialog-content").getAttribute("data-af-id"),
        "dialog-content",
      );
      await page.locator("#dialog-close").focus();
      await page.keyboard.press("Tab");
      assert.equal(
        await page
          .locator("#first-field")
          .evaluate((node) => node === document.activeElement),
        true,
      );
      await page.keyboard.press("Shift+Tab");
      assert.equal(
        await page
          .locator("#dialog-close")
          .evaluate((node) => node === document.activeElement),
        true,
      );
      await page.keyboard.press("Escape");
      await page.waitForFunction(
        () =>
          document.querySelector<HTMLDialogElement>("#dialog-content")?.open ===
            false && document.activeElement?.id === "dialog-trigger",
      );
      await page.locator("#dialog-trigger").click();
      await page.locator("#dialog-close").click();
      await page.waitForFunction(
        () =>
          document.querySelector<HTMLDialogElement>("#dialog-content")?.open ===
            false && document.activeElement?.id === "dialog-trigger",
      );
      assert.equal(await page.locator("#avatar-fallback").textContent(), "AB");
      assert.equal(await page.locator("#avatar-fallback").isVisible(), true);
      const style = await page.locator("#avatar").evaluate((node) => ({
        width: getComputedStyle(node).width,
        radius: getComputedStyle(node).borderRadius,
        slot: node.getAttribute("data-slot"),
      }));
      assert.equal(style.width, "48px");
      assert.ok(Number.parseFloat(style.radius) >= 24);
      assert.equal(style.slot, "avatar");
      assert.equal(
        await page
          .locator("#avatar-fallback")
          .evaluate((node) => getComputedStyle(node).fontWeight),
        "700",
      );
      for (const id of ["tooltip-provider", "tooltip-root"]) {
        assert.equal(
          await page.locator(`#${id}`).getAttribute("data-af-id"),
          id,
        );
        assert.equal(
          await page
            .locator(`#${id}`)
            .evaluate((node) => getComputedStyle(node).display),
          "contents",
        );
      }
      const snapshot = () =>
        page.locator("#hints [data-af-id]").evaluateAll((nodes) =>
          nodes.map((node) => ({
            id: node.id,
            identity: node.getAttribute("data-af-id"),
            text: node.textContent?.trim(),
          })),
        );
      const rowTrigger = page.locator("#hints button").first();
      await rowTrigger.focus();
      await page.waitForFunction(() => {
        const trigger = document.querySelector("#hints button");
        const id = trigger?.getAttribute("aria-describedby");
        return (
          !!id &&
          document.getElementById(id)?.textContent?.trim() === "Row help"
        );
      });
      await page.keyboard.press("Escape");
      await page.waitForFunction(
        () =>
          !document
            .querySelector("#hints button")
            ?.hasAttribute("aria-describedby"),
      );
      const before = await snapshot();
      assert.ok(before.length >= 6);
      assert.ok(before.every((node) => node.id === node.identity));
      await page.evaluate(async () => {
        const { client, gql } = await import(String("@afbin/apollo"));
        await client.updateQuery(
          {
            query: gql`
              {
                compiledPage
              }
            `,
          },
          (data: Record<string, any>) => ({
            ...data,
            compiledPage: {
              ...data.compiledPage,
              rows: [
                { key: "b", label: "Second" },
                { key: "a", label: "First" },
              ],
            },
          }),
        );
      });
      await page.waitForFunction(
        () =>
          document.querySelector("#hints button")?.textContent?.trim() ===
          "Second",
      );
      const after = await snapshot();
      assert.deepEqual(
        after.map((node) => node.id).sort(),
        before.map((node) => node.id).sort(),
      );
      assert.equal(await page.getByRole("alert").count(), 0);
      assert.deepEqual(errors, []);
      assert.deepEqual(external, []);
    } finally {
      await browser.close();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  },
);
