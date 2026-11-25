// End-to-end tests against a real Chrome with the extension loaded.
//
// Unit tests (vitest) cover pure logic; this covers everything that needs the
// actual chrome.* APIs: recording across real page loads, screenshots,
// IndexedDB storage, exports and the entitlement gate. Run:
//   npm run package && CI=1 xvfb-run --auto-servernum node tools/e2e.mjs
//
// Chrome shows a permission prompt for optional host permissions and
// Playwright cannot click it. So the extension under test is a COPY of dist/
// whose manifest moves "optional_host_permissions" into "host_permissions"
// (the permission a user grants at the prompt). Every file is identical to
// the shipped build. The shipped manifest itself is asserted separately, and
// the shipped build is also launched unmodified to check that nothing records
// without the grant.
import { chromium } from "playwright";
import { cp, readFile, rm, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import http from "node:http";
import { pathToFileURL } from "node:url";
import path from "node:path";

const root = process.cwd();
const dist = path.join(root, "dist");
const stage = path.join(root, ".e2e-ext");
const profile = path.join(root, ".e2e-profile");

const tests = [];
/**
 * opts.liveExtPay marks tests that talk to ExtensionPay's live API (in test
 * mode — an unpacked install always gets a test-mode key). Plain CI skips
 * them: running them on every push would mint a throwaway user record per
 * build and fail whenever a third party has a bad day. The release workflow
 * sets RUN_PAYMENT_E2E=1, which runs them and turns "can't run" into a
 * failure, so a release can never ship on a silently skipped payment test.
 */
export const test = (name, fn, opts = {}) => tests.push({ name, fn, ...opts });
const inCi = process.env.CI !== undefined && process.env.CI !== "";
const requirePayment = process.env.RUN_PAYMENT_E2E === "1";
const runLive = !inCi || requirePayment;

/** Thrown by a test that cannot run here; counted as skipped, not passed. */
class Skip extends Error {}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

// --- local test site (no network: loopback only) ---

const PAGES = {
  "/page1.html": `<!doctype html><meta charset="utf-8"><title>Demo shop</title>
<body style="margin:0;font-family:sans-serif;background:#fff">
<h1 id="title" style="font-size:64px;color:#000;margin:30px">Welcome to the demo shop</h1>
<p style="margin:30px"><a id="next" href="/page2.html" style="font-size:24px">Continue to checkout</a></p>
</body>`,
  "/page2.html": `<!doctype html><meta charset="utf-8"><title>Checkout</title>
<body style="margin:0;font-family:sans-serif;background:#fff">
<form onsubmit="return false" style="margin:30px;font-size:20px">
<p><label for="email">Email</label><br><input id="email" type="text" style="font-size:24px;color:#000;width:420px"></p>
<p><label for="pw">Password</label><br><input id="pw" type="password" style="font-size:28px;color:#000;width:420px"></p>
<p><label for="note">Order note</label><br><input id="note" type="text" value="Plain visible text" style="font-size:24px;color:#000;width:420px"></p>
<p><label for="ref">Reference</label><br><input id="ref" type="text" value="4242 4242 4242 4242" style="font-size:24px;color:#000;width:420px"></p>
<p><button id="submit" type="button" style="font-size:22px">Place order</button></p>
</form></body>`,
  "/other.html": `<!doctype html><meta charset="utf-8"><title>Other</title>
<body style="margin:30px"><button id="other" style="font-size:24px">Other button</button></body>`,
};

function startServer() {
  const server = http.createServer((req, res) => {
    const page = PAGES[new URL(req.url, "http://x").pathname];
    if (page === undefined) {
      res.writeHead(404).end("not found");
      return;
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(page);
  });
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port })),
  );
}

// --- helpers ---

const grantPro = (page) =>
  page.evaluate(() =>
    chrome.storage.local.set({
      proEntitlement: { active: true, checkedAt: Date.now() },
    }),
  );

const lum = `(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2])`;

/** Reads the IndexedDB the extension writes to, from an extension page. */
const readGuide = (page, id) =>
  page.evaluate(
    (guideId) =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open("stepsmith");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const req = open.result.transaction("guides").objectStore("guides").get(guideId);
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        };
      }),
    id,
  );

const allGuides = (page) =>
  page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open("stepsmith");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const req = open.result.transaction("guides").objectStore("guides").getAll();
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        };
      }),
  );

/** Mean brightness and dark-pixel count inside a CSS-pixel rect of a stored image. */
const inspectImage = (page, imageId, rect, viewportWidth) =>
  page.evaluate(
    async ({ imageId, rect, viewportWidth }) => {
      const record = await new Promise((resolve, reject) => {
        const open = indexedDB.open("stepsmith");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const req = open.result.transaction("images").objectStore("images").get(imageId);
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        };
      });
      const bitmap = await createImageBitmap(record.blob);
      const scale = bitmap.width / viewportWidth;
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = canvas.getContext("2d");
      ctx.drawImage(bitmap, 0, 0);
      const x = Math.max(0, Math.round(rect.x * scale));
      const y = Math.max(0, Math.round(rect.y * scale));
      const w = Math.max(1, Math.min(bitmap.width - x, Math.round(rect.w * scale)));
      const h = Math.max(1, Math.min(bitmap.height - y, Math.round(rect.h * scale)));
      const d = ctx.getImageData(x, y, w, h).data;
      let sum = 0;
      let dark = 0;
      for (let i = 0; i < d.length; i += 4) {
        const l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        sum += l;
        if (l < 90) dark++;
      }
      return { mean: sum / (d.length / 4), dark, width: bitmap.width, height: bitmap.height };
    },
    { imageId, rect, viewportWidth },
  );

const rectOf = (p, selector) =>
  p.evaluate((sel) => {
    const r = document.querySelector(sel).getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height, vw: window.innerWidth };
  }, selector);

async function openSite(context, port, route) {
  const p = await context.newPage();
  await p.goto(`http://127.0.0.1:${port}${route}`);
  await p.bringToFront();
  return p;
}

/** Starts recording `sitePage` from the extension page, like the popup does. */
async function startRecording(page, sitePage) {
  await sitePage.bringToFront();
  const target = sitePage.url();
  const response = await page.evaluate(async (url) => {
    const tab = (await chrome.tabs.query({})).find((t) => t.url === url);
    return chrome.runtime.sendMessage({
      type: "startRecording",
      tabId: tab.id,
      windowId: tab.windowId,
    });
  }, target);
  return response;
}

async function stepCount(page) {
  return page.evaluate(
    async () => (await chrome.storage.session.get("recording")).recording?.steps ?? 0,
  );
}

async function waitForSteps(page, n, timeout = 20_000) {
  const deadline = Date.now() + timeout;
  while ((await stepCount(page)) < n) {
    if (Date.now() > deadline) {
      throw new Error(`expected ${n} steps, recording has ${await stepCount(page)}`);
    }
    await page.waitForTimeout(200);
  }
}

async function stopRecording(page) {
  return page.evaluate(() => chrome.runtime.sendMessage({ type: "stopRecording", openEditor: false }));
}

const EMAIL = "jane.doe@example.com";
const SECRET = "hunter2-SECRET";

/**
 * Records the standard walk-through: open page 1, click the link to page 2,
 * fill email and password, click Place order. Returns the saved guide.
 */
async function recordCheckoutFlow(ctx) {
  const { page, context, port } = ctx;
  const site = await openSite(context, port, "/page1.html");
  const started = await startRecording(page, site);
  assert(started.ok === true, `could not start recording: ${JSON.stringify(started)}`);
  await waitForSteps(page, 1);
  await site.waitForTimeout(700);
  // A human press lasts ~100ms; an instant synthetic click would navigate
  // before the screenshot can be read back.
  await site.click("#next", { delay: 120 });
  await site.waitForURL("**/page2.html");
  await site.waitForLoadState("load");
  await site.waitForTimeout(900);
  await site.click("#email");
  await site.keyboard.type(EMAIL, { delay: 15 });
  await site.waitForTimeout(700);
  await site.click("#pw");
  await site.keyboard.type(SECRET, { delay: 15 });
  await site.waitForTimeout(700);
  const rects = {
    email: await rectOf(site, "#email"),
    pw: await rectOf(site, "#pw"),
    note: await rectOf(site, "#note"),
    ref: await rectOf(site, "#ref"),
  };
  await site.click("#submit");
  await waitForSteps(page, 7);
  const stopped = await stopRecording(page);
  const guide = await readGuide(page, stopped.guideId);
  return { guide, site, rects };
}

async function readDownload(page, buttonSelector) {
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 20_000 }),
    page.click(buttonSelector),
  ]);
  const file = await download.path();
  return { name: download.suggestedFilename(), bytes: await readFile(file) };
}

const openEditor = async (page, id) => {
  await page.bringToFront(); // a hidden tab throttles canvas work
  await page.goto(`chrome-extension://${page.url().split("/")[2]}/app/app.html#/guide/${id}`);
  await page.reload();
  await page.waitForSelector("#steps");
};

// --- build sanity ---

test("manifest version matches package.json", async ({ page, pkgVersion }) => {
  const version = await page.evaluate(() => chrome.runtime.getManifest().version);
  assert(version === pkgVersion, `manifest ${version} !== package ${pkgVersion}`);
});

test("the shipped manifest asks only for what it needs", async () => {
  const shipped = JSON.parse(await readFile(path.join(dist, "manifest.json"), "utf8"));
  assert(
    JSON.stringify(shipped.permissions) === JSON.stringify(["storage", "scripting"]),
    `permissions changed: ${JSON.stringify(shipped.permissions)}`,
  );
  assert(
    JSON.stringify(shipped.optional_host_permissions) === JSON.stringify(["<all_urls>"]),
    `optional host permissions changed: ${JSON.stringify(shipped.optional_host_permissions)}`,
  );
  assert(shipped.host_permissions === undefined, "the shipped build requires host access up front");
  assert(shipped.optional_permissions === undefined, "unexpected optional permissions");
  assert(shipped.web_accessible_resources === undefined, "unexpected web accessible resources");
});

// --- free core: record, capture, edit, export ---

test("recording across two page loads makes the right steps with screenshots", async (ctx) => {
  const { guide } = await recordCheckoutFlow(ctx);
  const captions = guide.steps.map((s) => s.caption);
  const expected = [
    "Go to **127.0.0.1**",
    "Click **Continue to checkout**",
    "Click **Email**",
    "Type in **Email**",
    "Click **Password**",
    "Type in **Password**",
    "Click **Place order**",
  ];
  assert(
    JSON.stringify(captions) === JSON.stringify(expected),
    `captions were ${JSON.stringify(captions)}`,
  );
  assert(guide.title === "Demo shop", `title was "${guide.title}"`);
  const missing = guide.steps.filter((s) => s.imageId === null).map((s) => s.caption);
  assert(missing.length === 0, `steps without a screenshot: ${JSON.stringify(missing)}`);
  const ids = new Set(guide.steps.map((s) => s.imageId));
  assert(ids.size === guide.steps.length, "steps share a screenshot record");
});

test("typed values and passwords are never stored", async (ctx) => {
  const { guide } = await recordCheckoutFlow(ctx);
  const everything = await ctx.page.evaluate(async () => {
    const local = JSON.stringify(await chrome.storage.local.get(null));
    const session = JSON.stringify(await chrome.storage.session.get(null));
    return local + session;
  });
  const raw = JSON.stringify(guide) + everything;
  assert(!raw.includes(SECRET), "THE PASSWORD WAS STORED");
  assert(!raw.includes("hunter2"), "part of the password was stored");
  assert(!raw.includes(EMAIL), "A TYPED VALUE WAS STORED");
  assert(!raw.includes("jane.doe"), "part of a typed value was stored");
});

test("password fields are blurred in screenshots, other fields are not", async (ctx) => {
  const { guide, rects } = await recordCheckoutFlow(ctx);
  const shot = guide.steps[6].imageId; // after everything was typed
  const pw = await inspectImage(ctx.page, shot, rects.pw, rects.pw.vw);
  const note = await inspectImage(ctx.page, shot, rects.note, rects.note.vw);
  assert(note.dark > 40, `control field has no dark text (${note.dark}); the test cannot tell`);
  assert(pw.dark === 0, `password field still has ${pw.dark} dark pixels: it was not blurred`);
});

test("free tier does not auto-blur emails or numbers", async (ctx) => {
  const { guide, rects } = await recordCheckoutFlow(ctx);
  const shot = guide.steps[6].imageId;
  const email = await inspectImage(ctx.page, shot, rects.email, rects.email.vw);
  const ref = await inspectImage(ctx.page, shot, rects.ref, rects.ref.vw);
  assert(email.dark > 40, `free email field was blurred (${email.dark} dark pixels)`);
  assert(ref.dark > 40, `free number field was blurred (${ref.dark} dark pixels)`);
});

test("with pro, emails and long numbers are blurred at capture time", async (ctx) => {
  await grantPro(ctx.page);
  const { guide, rects } = await recordCheckoutFlow(ctx);
  const shot = guide.steps[6].imageId;
  const email = await inspectImage(ctx.page, shot, rects.email, rects.email.vw);
  const ref = await inspectImage(ctx.page, shot, rects.ref, rects.ref.vw);
  const note = await inspectImage(ctx.page, shot, rects.note, rects.note.vw);
  assert(email.dark === 0, `email still has ${email.dark} dark pixels`);
  assert(ref.dark === 0, `number still has ${ref.dark} dark pixels`);
  assert(note.dark > 40, "plain text was blurred too");
});

test("a click highlights the clicked element in the screenshot", async (ctx) => {
  const { guide } = await recordCheckoutFlow(ctx);
  // Step 7 clicked #submit; the highlight colour is orange.
  const found = await ctx.page.evaluate(async (imageId) => {
    const record = await new Promise((resolve) => {
      const open = indexedDB.open("stepsmith");
      open.onsuccess = () => {
        const req = open.result.transaction("images").objectStore("images").get(imageId);
        req.onsuccess = () => resolve(req.result);
      };
    });
    const bitmap = await createImageBitmap(record.blob);
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(bitmap, 0, 0);
    const d = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data;
    let orange = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i] > 220 && d[i + 1] > 90 && d[i + 1] < 140 && d[i + 2] < 60) orange++;
    }
    return orange;
  }, guide.steps[6].imageId);
  assert(found > 200, `no highlight outline found (${found} orange pixels)`);
});

test("only the recorded tab is recorded", async (ctx) => {
  const { page, context, port } = ctx;
  const site = await openSite(context, port, "/page1.html");
  const other = await openSite(context, port, "/other.html");
  await startRecording(page, site);
  await waitForSteps(page, 1);
  await other.bringToFront();
  await other.click("#other");
  await other.waitForTimeout(1500);
  assert((await stepCount(page)) === 1, "a click in another tab was recorded");
  await stopRecording(page);
});

test("closing the recorded tab ends the recording and keeps the guide", async (ctx) => {
  const { page, context, port } = ctx;
  const site = await openSite(context, port, "/page1.html");
  await startRecording(page, site);
  await waitForSteps(page, 1);
  await site.close();
  await page.waitForTimeout(1200);
  const { recording } = await page.evaluate(() => chrome.runtime.sendMessage({ type: "getRecording" }));
  assert(recording === null, "recording continued after the tab closed");
  assert((await allGuides(page)).length === 1, "the guide was lost");
});

test("the editor shows steps and edits, reorders and deletes them", async (ctx) => {
  const { page } = ctx;
  const { guide } = await recordCheckoutFlow(ctx);
  await openEditor(page, guide.id);
  assert((await page.locator(".step").count()) === 7, "editor does not show 7 steps");
  assert((await page.locator(".shot img").count()) === 7, "editor does not show 7 screenshots");

  await page.locator(".caption-input").nth(1).fill("Open the checkout");
  await page.locator(".caption-input").nth(1).blur();
  await page.waitForTimeout(200);
  let saved = await readGuide(page, guide.id);
  assert(saved.steps[1].caption === "Open the checkout", "caption edit was not saved");

  const firstId = saved.steps[0].id;
  await page.locator(".move-down").first().click();
  await page.waitForTimeout(200);
  saved = await readGuide(page, guide.id);
  assert(saved.steps[1].id === firstId, "step did not move down");

  await page.locator(".delete-step").nth(2).click();
  await page.waitForTimeout(300);
  saved = await readGuide(page, guide.id);
  assert(saved.steps.length === 6, `delete left ${saved.steps.length} steps`);

  await page.click("#btn-add-text");
  await page.waitForTimeout(300);
  saved = await readGuide(page, guide.id);
  assert(saved.steps.length === 7 && saved.steps[6].imageId === null, "text step was not added");
});

test("the HTML export contains every step and screenshot", async (ctx) => {
  const { page } = ctx;
  const { guide } = await recordCheckoutFlow(ctx);
  await openEditor(page, guide.id);
  const { name, bytes } = await readDownload(page, "#btn-export-html");
  const html = bytes.toString("utf8");
  assert(name.endsWith(".html"), `unexpected file name ${name}`);
  assert((html.match(/class="step"/g) ?? []).length === 7, "HTML does not list 7 steps");
  assert((html.match(/src="data:image\/jpeg;base64,/g) ?? []).length === 7, "HTML is missing screenshots");
  assert(html.includes("<strong>Place order</strong>"), "caption markup missing");
  assert(!html.includes(SECRET) && !html.includes(EMAIL), "typed value leaked into the export");
  assert(!/https?:\/\//.test(html.replace(/<meta[^>]*>/g, "")), "export references an external URL");
});

test("copy as Markdown puts the numbered steps on the clipboard", async (ctx) => {
  const { page } = ctx;
  const { guide } = await recordCheckoutFlow(ctx);
  await openEditor(page, guide.id);
  await page.evaluate(() => {
    window.__copied = "";
    navigator.clipboard.writeText = async (text) => { window.__copied = text; };
  });
  await page.click("#btn-copy-md");
  await page.waitForTimeout(200);
  const text = await page.evaluate(() => window.__copied);
  assert(text.startsWith("# Demo shop"), "missing title");
  assert(text.includes("2. Click **Continue to checkout**"), "missing numbered step");
  assert(text.includes("7. Click **Place order**"), "missing last step");
});

test("delete all data empties the database", async (ctx) => {
  const { page } = ctx;
  await recordCheckoutFlow(ctx);
  assert((await allGuides(page)).length === 1, "setup: no guide");
  await page.goto(page.url().split("#")[0] + "#/settings");
  await page.reload();
  await page.click("#btn-delete-all");
  await page.click("#btn-delete-all");
  await page.waitForTimeout(400);
  assert((await allGuides(page)).length === 0, "guides survived");
});

// --- pro features: locked for free, working with an entitlement ---

test("pro features are locked and explained for a free user", async (ctx) => {
  const { page } = ctx;
  const { guide } = await recordCheckoutFlow(ctx);
  await openEditor(page, guide.id);
  let downloaded = false;
  page.on("download", () => { downloaded = true; });
  await page.click("#btn-export-pdf");
  await page.waitForTimeout(600);
  assert(await page.locator("#pro-locked").isVisible(), "no explanation shown");
  assert(!downloaded, "PDF was produced without Pro");
  await page.click("#btn-export-zip");
  await page.waitForTimeout(400);
  assert(!downloaded, "zip was produced without Pro");
  await page.locator(".edit-image").first().click();
  await page.waitForTimeout(300);
  assert((await page.locator(".edit-toolbar").count()) === 0, "image tools opened without Pro");
  await page.goto(page.url().split("#")[0] + "#/settings");
  await page.reload();
  assert(await page.locator("#brand-footer").isDisabled(), "branding is editable without Pro");
});

test("with pro, PDF export is a valid PDF with a page per step", async (ctx) => {
  const { page } = ctx;
  await grantPro(page);
  const { guide } = await recordCheckoutFlow(ctx);
  await openEditor(page, guide.id);
  const { name, bytes } = await readDownload(page, "#btn-export-pdf");
  assert(name.endsWith(".pdf"), `unexpected file name ${name}`);
  const text = bytes.toString("latin1");
  assert(text.startsWith("%PDF-1.4"), "not a PDF");
  assert(text.trimEnd().endsWith("%%EOF"), "PDF is truncated");
  const pages = (text.match(/\/Type \/Page\b(?!s)/g) ?? []).length;
  assert(pages === 7, `expected 7 pages, found ${pages}`);
  assert((text.match(/\/Filter \/DCTDecode/g) ?? []).length === 7, "pages have no image");
});

test("with pro, a brand-new text-only guide exports to PDF", async ({ page }) => {
  // The same path the purchase test uses to prove Pro works after paying.
  await grantPro(page);
  await page.reload();
  await page.click("#btn-new-guide");
  await page.waitForSelector("#steps");
  const { bytes } = await readDownload(page, "#btn-export-pdf");
  const text = bytes.toString("latin1");
  assert(text.startsWith("%PDF-"), "not a PDF");
  assert((text.match(/\/Type \/Page\b(?!s)/g) ?? []).length === 1, "expected one page");
});

test("with pro, the Markdown zip holds guide.md and the screenshots", async (ctx) => {
  const { page } = ctx;
  await grantPro(page);
  const { guide } = await recordCheckoutFlow(ctx);
  await openEditor(page, guide.id);
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 20_000 }),
    page.click("#btn-export-zip"),
  ]);
  const file = await download.path();
  const zipPath = `${file}.zip`;
  await cp(file, zipPath);
  let listing = "";
  try {
    listing = execFileSync("unzip", ["-t", zipPath], { encoding: "utf8" });
    assert(/No errors detected/.test(listing), `unzip reports problems: ${listing}`);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    listing = (await readFile(file)).toString("latin1"); // no unzip binary: names are stored plain
  }
  assert(listing.includes("guide.md"), "guide.md missing");
  assert(listing.includes("images/step-07.jpg"), "step images missing");
  await rm(zipPath, { force: true });
});

test("with pro, redaction really changes the saved pixels", async (ctx) => {
  const { page } = ctx;
  await grantPro(page);
  const { guide, site } = await recordCheckoutFlow(ctx);
  const title = await (async () => {
    await site.goto(site.url().replace("page2", "page1"));
    return rectOf(site, "#title");
  })();
  const imageId = guide.steps[0].imageId; // the opening screenshot of page 1
  const before = await inspectImage(page, imageId, title, title.vw);
  assert(before.dark > 100, `no heading text to redact (${before.dark} dark pixels)`);

  await openEditor(page, guide.id);
  await page.locator(".edit-image").first().click();
  await page.waitForSelector(".edit-toolbar");
  await page.click(".tool-black");
  const img = page.locator(".shot img").first();
  await img.scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy(0, -100)); // clear the sticky header
  const box = await img.boundingBox();
  const ratio = box.width / title.vw;
  const x0 = box.x + title.x * ratio;
  const y0 = box.y + title.y * ratio;
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  await page.mouse.move(x0 + (title.w * ratio) / 2, y0 + (title.h * ratio) / 2, { steps: 5 });
  await page.mouse.move(x0 + title.w * ratio, y0 + title.h * ratio, { steps: 5 });
  await page.mouse.up();
  await page.waitForFunction(() => document.querySelector(".edit-toolbar .status")?.textContent === "Applied.", null, { timeout: 15_000 });
  const inner = { x: title.x + 4, y: title.y + 4, w: title.w - 8, h: title.h - 8 };
  const after = await inspectImage(page, imageId, inner, title.vw);
  assert(after.mean < 12, `region is not blacked out (mean brightness ${after.mean.toFixed(1)})`);
  const untouched = await inspectImage(page, imageId, { x: title.x, y: title.y + title.h + 80, w: title.w, h: 100 }, title.vw);
  assert(untouched.mean > 200, "redaction spread outside the dragged box");

  // Undo restores the original pixels.
  await page.click(".edit-undo");
  await page.waitForTimeout(2000);
  const restored = await inspectImage(page, imageId, inner, title.vw);
  assert(restored.dark > 50, "undo did not restore the image");
});

test("with pro, crop shrinks the saved image", async (ctx) => {
  const { page } = ctx;
  await grantPro(page);
  const { guide } = await recordCheckoutFlow(ctx);
  const imageId = guide.steps[0].imageId;
  const before = await inspectImage(page, imageId, { x: 0, y: 0, w: 10, h: 10 }, 1000);
  await openEditor(page, guide.id);
  await page.locator(".edit-image").first().click();
  await page.waitForSelector(".edit-toolbar");
  await page.click(".tool-crop");
  const img = page.locator(".shot img").first();
  await img.scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy(0, -100)); // clear the sticky header
  const box = await img.boundingBox();
  await page.mouse.move(box.x + 10, box.y + 10);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 6 });
  await page.mouse.up();
  await page.waitForFunction(() => document.querySelector(".edit-toolbar .status")?.textContent === "Applied.", null, { timeout: 15_000 });
  const after = await inspectImage(page, imageId, { x: 0, y: 0, w: 10, h: 10 }, 1000);
  assert(after.width < before.width && after.height < before.height,
    `crop did not shrink the image (${before.width}x${before.height} -> ${after.width}x${after.height})`);
});

test("with pro, saved branding appears in the HTML export", async (ctx) => {
  const { page } = ctx;
  await grantPro(page);
  const { guide } = await recordCheckoutFlow(ctx);
  await page.goto(page.url().split("#")[0] + "#/settings");
  await page.reload();
  await page.locator("#brand-footer").fill("Acme Support <desk>");
  await page.locator("#brand-footer").blur();
  await page.evaluate(() => {
    const el = document.getElementById("brand-accent");
    el.value = "#ff0066";
    el.dispatchEvent(new Event("change"));
  });
  await page.waitForTimeout(300);
  await openEditor(page, guide.id);
  const { bytes } = await readDownload(page, "#btn-export-html");
  const html = bytes.toString("utf8");
  assert(html.includes("#ff0066"), "accent colour missing");
  assert(html.includes("Acme Support &lt;desk&gt;"), "footer missing or unescaped");
});

test("without pro, saved branding is ignored by exports", async (ctx) => {
  const { page } = ctx;
  const { guide } = await recordCheckoutFlow(ctx);
  await page.evaluate(() =>
    chrome.storage.local.set({ branding: { accent: "#ff0066", footer: "Sneaky footer", logoDataUrl: "" } }));
  await openEditor(page, guide.id);
  const { bytes } = await readDownload(page, "#btn-export-html");
  const html = bytes.toString("utf8");
  assert(!html.includes("Sneaky footer") && !html.includes("#ff0066"), "branding applied without Pro");
});

// --- the shipped build, without the permission grant ---

test("the shipped build records nothing until permission is granted", async ({ extId: _ }) => {
  const context = await chromium.launchPersistentContext(`${profile}-shipped`, {
    headless: false,
    viewport: { width: 1000, height: 800 },
    args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
  });
  const { server, port } = await startServer();
  try {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent("serviceworker");
    const id = new URL(worker.url()).host;
    const app = await context.newPage();
    await app.goto(`chrome-extension://${id}/app/app.html`);
    const site = await context.newPage();
    await site.goto(`http://127.0.0.1:${port}/page1.html`);
    await site.bringToFront();
    const granted = await app.evaluate(() => chrome.permissions.contains({ origins: ["<all_urls>"] }));
    assert(granted === false, "the shipped build already has host access");
    const response = await app.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ active: true });
      return chrome.runtime.sendMessage({ type: "startRecording", tabId: tab.id, windowId: tab.windowId });
    });
    assert(response.ok === false && response.error === "needsPermission", `unexpected: ${JSON.stringify(response)}`);
    assert((await allGuides(app)).length === 0, "a guide was created without permission");

    // The workspace page asks for it, from a page that stays open.
    const tabId = await app.evaluate(async () => (await chrome.tabs.query({})).find((t) => t.active)?.id ?? 1);
    await app.goto(`chrome-extension://${id}/app/app.html?record=${tabId}&window=1`);
    await app.waitForSelector("#btn-allow");
    const label = await app.locator("#btn-allow").innerText();
    assert(label.includes("Allow"), `unexpected button "${label}"`);
  } finally {
    server.close();
    await context.close();
    await rm(`${profile}-shipped`, { recursive: true, force: true });
  }
});


// --- payment stays unreachable until asked for ---

// --- phase 6: payment stays unreachable until asked for ---

test("content scripts only ever run on extensionpay.com", async ({ page }) => {
  // Two things guarded here. While payment is unconfigured there should be no
  // content script at all — declaring access the extension never uses is not
  // something a privacy extension gets to do. And once it is configured, the
  // match must stay narrow: the upstream ExtPay sample injects its script
  // into every http(s) page, which would be indefensible.
  const scripts = await page.evaluate(
    () => chrome.runtime.getManifest().content_scripts,
  );
  if (scripts === undefined) return;
  assert(scripts.length === 1, `expected 1 content script, got ${scripts.length}`);
  assert(
    JSON.stringify(scripts[0].matches) === JSON.stringify(["https://extensionpay.com/*"]),
    `content script matches too much: ${JSON.stringify(scripts[0].matches)}`,
  );
});

test("no payment code ships while payment is unconfigured", async ({ page }) => {
  const present = await page.evaluate(async () => {
    const response = await fetch(chrome.runtime.getURL("extpay/ExtPay.js")).catch(
      () => null,
    );
    return response !== null && response.ok;
  });
  const configured = await page.evaluate(
    () => chrome.runtime.getManifest().content_scripts !== undefined,
  );
  assert(
    present === configured,
    present
      ? "the AGPL payment library shipped in a build with no payment flow"
      : "payment is configured but the library is missing from the build",
  );
});

test("the payment library loads iff payment is configured", async ({
  page,
  context,
}) => {
  const worker = context.serviceWorkers()[0];
  // MV3 only permits importScripts() during the worker's initial evaluation,
  // so this has to happen at startup. An earlier version loaded it lazily on
  // click, which silently failed with ERR_FAILED and made Upgrade a no-op.
  const configured = await page.evaluate(
    () => chrome.runtime.getManifest().content_scripts !== undefined,
  );
  const loaded = await worker.evaluate(() => typeof self.ExtPay !== "undefined");
  assert(
    loaded === configured,
    loaded
      ? "payment library loaded in a build with no payment flow"
      : "payment library failed to load — Upgrade would silently do nothing",
  );
});

test("beginUpgrade actually opens a checkout when configured", async ({
  page,
  context,
}) => {
  const configured = await page.evaluate(
    () => chrome.runtime.getManifest().content_scripts !== undefined,
  );
  const response = await page.evaluate(() =>
    chrome.runtime.sendMessage({ type: "beginUpgrade" }),
  );
  if (!configured) {
    assert(response.started === false, "unconfigured build reported a start");
    return;
  }
  assert(response.started === true, "Upgrade reported failure");
  // Confirm a real checkout tab appeared, not just a truthy return value.
  let checkout;
  for (const deadline = Date.now() + 15_000; !checkout && Date.now() < deadline; ) {
    checkout = context.pages().find((p) => p.url().includes("extensionpay.com"));
    if (!checkout) await page.waitForTimeout(250);
  }
  assert(checkout !== undefined, "no checkout page opened");
  assert(
    checkout.url().includes("/choose-plan"),
    `unexpected checkout url: ${checkout.url()}`,
  );
  await checkout.close();
}, { liveExtPay: true });

/** Visible-or-not within a short wait, without failing the test. */
const shows = (locator, timeout = 3000) =>
  locator.first().waitFor({ state: "visible", timeout }).then(() => true, () => false);

/**
 * First visible match for `selector` in the page or any of its frames.
 * Stripe's newer Checkout renders the card form inside a js.stripe.com
 * iframe, so searching only the top document finds nothing.
 */
async function inAnyFrame(p, selector, timeout) {
  const deadline = Date.now() + timeout;
  do {
    for (const frame of p.frames()) {
      const loc = frame.locator(selector).first();
      if (await loc.isVisible().catch(() => false)) return loc;
    }
    await p.waitForTimeout(500);
  } while (Date.now() < deadline);
  return undefined;
}

async function fillIn(p, selector, value, { required = true, timeout = 20_000 } = {}) {
  const loc = await inAnyFrame(p, selector, required ? timeout : 2000);
  if (loc) await loc.fill(value);
  else if (required) throw new Error(`Stripe field not found: ${selector}`);
}

/**
 * Fills Stripe's hosted Checkout with the 4242 test card. Fields are found
 * by their standard autocomplete tokens, in whichever frame holds them.
 * Optional fields (email, accordion, name, postal code) depend on account
 * settings and the runner's country, so each is filled only if shown.
 */
async function fillStripeCheckout(p) {
  await p.waitForLoadState("networkidle").catch(() => {});
  await fillIn(p, 'input[autocomplete="email"], #email', `e2e+${Date.now()}@example.com`, { required: false });
  const cardMethod = await inAnyFrame(
    p, '[data-testid="card-accordion-item-button"], button[value="card"], [data-value="card"]', 2000);
  if (cardMethod) await cardMethod.click();
  await fillIn(p, 'input[autocomplete="cc-number"], input[name="number"], #cardNumber', "4242424242424242");
  await fillIn(p, 'input[autocomplete="cc-exp"], input[name="expiry"], #cardExpiry', "12 / 34");
  await fillIn(p, 'input[autocomplete="cc-csc"], input[name="cvc"], #cardCvc', "123");
  await fillIn(p, 'input[autocomplete="cc-name"], #billingName', "E2E Test", { required: false });
  await fillIn(p, 'input[autocomplete="postal-code"], input[name="postalCode"], #billingPostalCode', "10001", { required: false });
  const submit = await inAnyFrame(
    p, '[data-testid="hosted-payment-submit-button"], button[type="submit"]', 10_000);
  if (!submit) throw new Error("Stripe submit button not found");
  await submit.click();
}

/**
 * On failure: log form *structure* only — tags, names, types, autocomplete
 * tokens, per frame. Never page text, labels, values or screenshots: this
 * repo's CI logs are public, and Stripe pages show the merchant's legal name.
 */
async function dumpPage(p, label) {
  try {
    const frames = [];
    for (const frame of p.frames()) {
      const url = new URL(frame.url());
      const fields = await frame.evaluate(() =>
        [...document.querySelectorAll("input,select,button")].map((e) =>
          [e.tagName, e.name, e.type, e.getAttribute("autocomplete"),
            e.getAttribute("data-testid"), e.offsetParent !== null ? "visible" : "hidden"]
            .filter(Boolean).join("|")),
      ).catch(() => ["(unreadable)"]);
      frames.push({ frame: `${url.host}${url.pathname.slice(0, 50)}`, fields });
    }
    console.log(`\n--- ${label} form structure ---\n${JSON.stringify(frames, null, 2)}\n---`);
  } catch (e) {
    console.log(`(form dump failed: ${e.message})`);
  }
}

// The whole paid path as a customer walks it: Upgrade → ExtensionPay →
// Stripe Checkout → back → Pro actually changes what gets swept. Test mode
// only: it refuses to type a card anywhere that isn't a Stripe *test* session.

test("a test-mode purchase unlocks pro end to end", async ({ page, context }) => {
  const configured = await page.evaluate(
    () => chrome.runtime.getManifest().content_scripts !== undefined,
  );
  const password = process.env.EXTPAY_DEV_PASSWORD;
  if (!configured || !password) {
    const why = !configured ? "payment is not configured" : "EXTPAY_DEV_PASSWORD is not set";
    if (requirePayment) throw new Error(`${why}; the release gate requires a real test-mode purchase`);
    throw new Skip(why);
  }

  const proActive = () =>
    page.evaluate(async () =>
      (await chrome.storage.local.get("proEntitlement")).proEntitlement?.active === true);
  assert(!(await proActive()), "already pro before paying");

  const opened = context.waitForEvent("page", {
    predicate: (p) => p.url().includes("extensionpay.com"),
    timeout: 20_000,
  });
  await page.evaluate(() => chrome.runtime.sendMessage({ type: "beginUpgrade" }));
  const checkout = await opened;
  await checkout.waitForLoadState("networkidle");
  assert(
    (await checkout.title()).includes("test mode"),
    "ExtensionPay is not in test mode; refusing to continue",
  );

  // First (and for Stepsmith, only) priced plan, e.g. "$9 Lifetime".
  await checkout.locator("button").filter({ hasText: /\$\d/ }).first().click();
  await checkout.locator('input[name="password"]').fill(password);
  await checkout.getByRole("button", { name: /test payment page/i }).click();
  await checkout.waitForURL(/checkout\.stripe\.com/, { timeout: 30_000 });
  assert(
    checkout.url().includes("cs_test_"),
    `not a Stripe test session (${new URL(checkout.url()).pathname}); refusing to enter a card`,
  );

  try {
    await fillStripeCheckout(checkout);
  } catch (error) {
    await dumpPage(checkout, "stripe-checkout");
    throw error;
  }

  // onPaid arrives via the content script on extensionpay.com's success page.
  const deadline = Date.now() + 90_000;
  while (!(await proActive())) {
    if (Date.now() > deadline) {
      throw new Error(`paid, but Pro never unlocked (checkout ended at ${checkout.url()})`);
    }
    await page.waitForTimeout(2000);
  }
  await checkout.close().catch(() => {});


  // Entitlement alone isn't the point: a Pro feature must now behave as Pro.
  await page.goto(page.url().split("#")[0]);
  await page.evaluate(async () => {
    await chrome.runtime.sendMessage({ type: "deleteAllData" });
  });
  await page.reload();
  await page.click("#btn-new-guide");
  await page.waitForSelector("#steps");
  const { bytes } = await readDownload(page, "#btn-export-pdf");
  assert(bytes.toString("latin1").startsWith("%PDF-"), "after purchase, PDF export did not produce a PDF");
}, { liveExtPay: true });

test("a free user's session makes no external network requests", async (ctx) => {
  const { page, context, extId, port } = ctx;
  const external = [];
  const record = (url) => {
    const ok =
      url.startsWith(`chrome-extension://${extId}`) ||
      url.startsWith("data:") ||
      url.startsWith("blob:") ||
      url.startsWith(`http://127.0.0.1:${port}/`);
    if (!ok) external.push(url);
  };
  context.on("request", (request) => record(request.url()));

  // Everything a normal user touches: record, edit, export, settings, popup.
  const { guide } = await recordCheckoutFlow(ctx);
  await openEditor(page, guide.id);
  await readDownload(page, "#btn-export-html");
  await page.goto(page.url().split("#")[0] + "#/settings");
  await page.reload();
  await page.waitForTimeout(500);
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extId}/popup/popup.html`);
  await popup.waitForTimeout(500);
  await popup.close();
  await page.waitForTimeout(600);

  assert(
    external.length === 0,
    `made ${external.length} external request(s): ${external.slice(0, 5).join(", ")}`,
  );
});

test("the upgrade offer matches whether payment is configured", async ({ page }) => {
  await page.goto(page.url().split("#")[0] + "#/settings");
  await page.reload();
  await page.waitForSelector("#pro-panel");
  const state = await page.evaluate(() => ({
    hidden: document.getElementById("btn-upgrade").hidden,
    note: document.getElementById("pro-note")?.textContent ?? "",
    configured: chrome.runtime.getManifest().content_scripts !== undefined,
  }));
  if (state.configured) {
    assert(!state.hidden, "payment is configured but no upgrade was offered");
    assert(state.note.includes("free"), `unexpected pro copy: "${state.note}"`);
  } else {
    // Offering to take money through a flow that cannot complete is worse
    // than not offering at all.
    assert(state.hidden, "offered a purchase through a flow that cannot complete");
  }
});

// --- runner ---

export async function run() {
  const pkgVersion = JSON.parse(await readFile("package.json", "utf8")).version;

  await rm(profile, { recursive: true, force: true });
  await rm(stage, { recursive: true, force: true });
  await cp(dist, stage, { recursive: true });
  const manifest = JSON.parse(await readFile(path.join(stage, "manifest.json"), "utf8"));
  manifest.host_permissions = manifest.optional_host_permissions;
  delete manifest.optional_host_permissions;
  await writeFile(path.join(stage, "manifest.json"), JSON.stringify(manifest, null, 2));
  const { server, port } = await startServer();
  const context = await chromium.launchPersistentContext(profile, {
    headless: false,
    viewport: { width: 1000, height: 800 },
    args: [`--disable-extensions-except=${stage}`, `--load-extension=${stage}`],
  });

  const failures = [];
  const skipped = [];
  try {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent("serviceworker");
    const extId = new URL(worker.url()).host;
    const page = await context.newPage();
    const consoleErrors = [];
    page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));
    if (process.env.E2E_DEBUG) page.on("console", (m) => console.log(`    [page] ${m.text()}`));
    if (process.env.E2E_DEBUG) page.on("pageerror", (e) => console.log(`    [pageerror] ${e.message}`));
    const appUrl = `chrome-extension://${extId}/app/app.html`;
    await page.goto(appUrl);

    const ctx = { page, context, extId, worker, pkgVersion, port };
    const only = process.env.E2E_ONLY ? new RegExp(process.env.E2E_ONLY, "i") : null;
    for (const { name, fn, liveExtPay } of tests) {
      if (only !== null && !only.test(name)) continue;
      if (liveExtPay && !runLive) {
        skipped.push(name);
        console.log(`  SKIP  ${name} (hits ExtensionPay's live API)`);
        continue;
      }
      try {
        // Each test starts from a clean slate so ordering never matters.
        for (const extra of context.pages()) if (extra !== page) await extra.close().catch(() => {});
        await page.goto(appUrl);
        await page.evaluate(async () => {
          await chrome.runtime.sendMessage({ type: "stopRecording", openEditor: false });
          await chrome.runtime.sendMessage({ type: "deleteAllData" });
          await chrome.storage.local.clear();
          await chrome.storage.sync.clear();
          if (chrome.storage.session) await chrome.storage.session.clear();
        });
        await page.reload();
        await fn(ctx);
        console.log(`  PASS  ${name}`);
      } catch (error) {
        if (error instanceof Skip) {
          skipped.push(name);
          console.log(`  SKIP  ${name} (${error.message})`);
          continue;
        }
        failures.push({ name, error });
        console.log(`  FAIL  ${name}\n        ${error.message}`);
      }
    }
    if (consoleErrors.length) {
      console.log("\n  console errors:");
      for (const e of consoleErrors) console.log(`    ${e}`);
    }
  } finally {
    server.close();
    await context.close();
    await rm(profile, { recursive: true, force: true });
    await rm(stage, { recursive: true, force: true });
  }

  const ran = tests.length - skipped.length;
  console.log(
    `\n${ran - failures.length}/${ran} e2e tests passed` +
      (skipped.length ? ` (${skipped.length} skipped)` : ""),
  );
  // The release job refuses to publish unless this file says this exact
  // version ran every test, skipped none, and failed none.
  if (process.env.E2E_RESULTS) {
    await writeFile(process.env.E2E_RESULTS, `${JSON.stringify({
      version: pkgVersion,
      total: tests.length,
      passed: ran - failures.length,
      failed: failures.map((f) => f.name),
      skipped,
    }, null, 2)}\n`);
  }
  if (failures.length) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await run();
