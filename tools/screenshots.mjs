// Automated store screenshots (run: npm run build && node tools/screenshots.mjs).
// Launches real Chrome with the extension loaded, records a real guide on a
// local demo site, and captures 1280x800 PNGs of the real UI into
// store-assets/.
//
// The extension is staged from a COPY of dist/ — the shipped build is never
// modified. The staging only moves the optional host permission into the
// manifest (Playwright cannot click Chrome's permission prompt) and adds a
// popup frame page for the popup shot. Pro is switched on for the shots so
// the redaction tools are visible; the listing labels them as Pro.
import { chromium } from "playwright";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";

const root = process.cwd();
const stageDir = path.join(root, ".stage-ext");
const profileDir = path.join(root, ".stage-profile");
const outDir = path.join(root, "store-assets");

await rm(stageDir, { recursive: true, force: true });
await rm(profileDir, { recursive: true, force: true });
await cp(path.join(root, "dist"), stageDir, { recursive: true });
await mkdir(outDir, { recursive: true });

const manifest = JSON.parse(await readFile(path.join(stageDir, "manifest.json"), "utf8"));
manifest.host_permissions = manifest.optional_host_permissions;
delete manifest.optional_host_permissions;
await writeFile(path.join(stageDir, "manifest.json"), JSON.stringify(manifest, null, 2));

const frame = (headline, src, w, h) =>
  `<!doctype html><html><head><meta charset="utf-8"><style>
  body { margin:0; height:100vh; display:flex; flex-direction:column; gap:26px;
    align-items:center; justify-content:center;
    background:linear-gradient(135deg,#4f46e5,#1e1b4b);
    font-family:system-ui,sans-serif; }
  h1 { color:#fff; font-size:29px; margin:0; font-weight:800; letter-spacing:-.5px;
    text-align:center; max-width:900px; }
  .shot { box-shadow:0 24px 80px rgba(0,0,0,.45); border-radius:12px; overflow:hidden; }
  iframe { width:${w}px; height:${h}px; border:none; background:#fff; display:block; }
  </style></head><body>
  <h1>${headline}</h1>
  <div class="shot"><iframe src="${src}"></iframe></div>
  </body></html>`;

await writeFile(
  path.join(stageDir, "stage-frame.html"),
  frame("Record once. Stepsmith writes the guide.", "popup/popup.html", 340, 330),
);

// --- demo site ---
const shell = (title, body) => `<!doctype html><meta charset="utf-8"><title>${title}</title>
<style>
body{margin:0;font-family:system-ui,sans-serif;background:#f3f4f8;color:#111827}
.bar{background:#111827;color:#fff;padding:14px 28px;font-weight:700;font-size:18px}
.wrap{max-width:760px;margin:36px auto;background:#fff;border-radius:12px;padding:28px 32px;box-shadow:0 2px 10px rgba(0,0,0,.08)}
h1{margin:0 0 6px;font-size:28px} p.sub{color:#6b7280;margin:0 0 22px}
table{width:100%;border-collapse:collapse;margin-bottom:24px} td,th{text-align:left;padding:10px 6px;border-bottom:1px solid #e5e7eb}
a.btn,button{display:inline-block;background:#2563eb;color:#fff;border:0;border-radius:8px;padding:12px 20px;font-size:18px;font-weight:600;text-decoration:none;cursor:pointer}
label{display:block;font-weight:600;margin:18px 0 6px} input{width:100%;box-sizing:border-box;font-size:20px;padding:10px;border:1px solid #9ca3af;border-radius:8px}
</style><div class="bar">Northwind Admin</div><div class="wrap">${body}</div>`;
const PAGES = {
  "/settings.html": shell("Team settings", `<h1>Team settings</h1><p class="sub">People with access to Northwind</p>
<table><tr><th>Name</th><th>Role</th></tr><tr><td>Maya Ortiz</td><td>Owner</td></tr><tr><td>Sam Lee</td><td>Editor</td></tr><tr><td>Ravi Patel</td><td>Viewer</td></tr></table>
<a class="btn" id="invite" href="/invite.html">Invite teammate</a>`),
  "/invite.html": shell("Invite a teammate", `<h1>Invite a teammate</h1><p class="sub">They will get an email with a sign-in link</p>
<form onsubmit="return false"><label for="email">Work email</label><input id="email" type="text">
<label for="pw">Your password</label><input id="pw" type="password">
<p style="margin-top:26px"><button id="send" type="button">Send invite</button></p></form>`),
};
const server = http.createServer((req, res) => {
  const page = PAGES[new URL(req.url, "http://x").pathname];
  if (!page) return void res.writeHead(404).end();
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(page);
});
const port = await new Promise((r) => server.listen(0, "127.0.0.1", () => r(server.address().port)));

const context = await chromium.launchPersistentContext(profileDir, {
  headless: false,
  viewport: { width: 1280, height: 800 },
  args: [`--disable-extensions-except=${stageDir}`, `--load-extension=${stageDir}`],
});

try {
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent("serviceworker");
  const extId = new URL(worker.url()).host;
  const extUrl = (p) => `chrome-extension://${extId}/${p}`;
  const app = await context.newPage();
  await app.goto(extUrl("app/app.html"));
  await app.evaluate(() =>
    chrome.storage.local.set({ proEntitlement: { active: true, checkedAt: Date.now() } }),
  );

  // Record a real guide.
  const site = await context.newPage();
  await site.goto(`http://127.0.0.1:${port}/settings.html`);
  await site.bringToFront();
  await app.evaluate(async (url) => {
    const tab = (await chrome.tabs.query({})).find((t) => t.url === url);
    await chrome.runtime.sendMessage({ type: "startRecording", tabId: tab.id, windowId: tab.windowId });
  }, site.url());
  await site.waitForTimeout(1200);
  await site.click("#invite", { delay: 150 });
  await site.waitForURL("**/invite.html");
  await site.waitForTimeout(1200);
  await site.click("#email");
  await site.keyboard.type("priya.nair@northwind.example", { delay: 20 });
  await site.waitForTimeout(800);
  await site.click("#pw");
  await site.keyboard.type("not-a-real-password", { delay: 20 });
  await site.waitForTimeout(800);
  await site.click("#send", { delay: 150 });
  await site.waitForTimeout(2500);

  // 4. Popup while recording (the real popup in a frame, real recording state).
  await app.bringToFront();
  await app.goto(extUrl("stage-frame.html"));
  await app.waitForTimeout(900);
  await app.screenshot({ path: path.join(outDir, "screenshot-4-popup.png") });

  const stopped = await app.evaluate(() =>
    chrome.runtime.sendMessage({ type: "stopRecording", openEditor: false }),
  );

  // Tidy the captions through the real editor UI.
  await app.goto(extUrl(`app/app.html#/guide/${stopped.guideId}`));
  await app.reload();
  await app.waitForSelector("#steps");
  await app.locator("#guide-title").fill("Invite a teammate to Northwind");
  await app.locator("#guide-title").blur();
  const captions = [
    "Open **Team settings**",
    "Click **Invite teammate**",
    "Click **Work email**",
    "Type in **Work email**",
    "Click **Your password**",
    "Type in **Your password**",
    "Click **Send invite**",
  ];
  const inputs = app.locator(".caption-input");
  for (let i = 0; i < captions.length; i++) {
    if ((await inputs.count()) > i) {
      await inputs.nth(i).fill(captions[i]);
      await inputs.nth(i).blur();
    }
  }
  await app.waitForTimeout(400);

  // A few other guides so the library looks lived-in (real "New guide" flow).
  await app.evaluate(async () => {
    const open = indexedDB.open("stepsmith");
    await new Promise((resolve) => { open.onsuccess = resolve; });
    const db = open.result;
    const mk = (title, captions, ago) => ({
      id: crypto.randomUUID(), title, createdAt: Date.now() - ago, updatedAt: Date.now() - ago,
      steps: captions.map((c) => ({ id: crypto.randomUUID(), kind: "text", caption: c, imageId: null })),
    });
    const tx = db.transaction("guides", "readwrite");
    const store = tx.objectStore("guides");
    store.put(mk("Reset a customer's two-factor login",
      ["Open **Customers**", "Click **Security**", "Click **Reset 2FA**", "Click **Confirm**"], 26 * 3600e3));
    store.put(mk("File a bug report for the checkout page",
      ["Open **Checkout**", "Click **Add to basket**", "Click **Pay now**", "Note the error message"], 3 * 24 * 3600e3));
    await new Promise((resolve) => { tx.oncomplete = resolve; });
  });

  // 2. Editor
  await app.goto(extUrl(`app/app.html#/guide/${stopped.guideId}`));
  await app.reload();
  await app.waitForSelector("#steps");
  await app.waitForTimeout(600);
  // Chrome restores the old scroll position on reload; show the guide's top.
  await app.evaluate(() => window.scrollTo(0, 0));
  await app.waitForTimeout(200);
  await app.screenshot({ path: path.join(outDir, "screenshot-2-editor.png") });

  // 3. Redact and annotate tools on the last step.
  await app.locator(".edit-image").nth(6).click();
  await app.waitForSelector(".edit-toolbar");
  await app.click(".tool-box");
  const img = app.locator(".shot img").nth(6);
  await img.scrollIntoViewIfNeeded();
  await app.evaluate(() => window.scrollBy(0, 120));
  await app.waitForTimeout(500);
  await app.screenshot({ path: path.join(outDir, "screenshot-3-redact.png") });

  // 1. Library
  await app.goto(extUrl("app/app.html#/"));
  await app.reload();
  await app.waitForSelector("#guide-list");
  await app.waitForTimeout(400);
  await app.screenshot({ path: path.join(outDir, "screenshot-1-library.png") });

  // 5. The permission screen, with its plain-language explanation.
  await app.goto(extUrl("app/app.html?record=1&window=1"));
  await app.waitForSelector("h1");
  await app.waitForTimeout(400);
  await app.screenshot({ path: path.join(outDir, "screenshot-5-permission.png") });
} finally {
  server.close();
  await context.close();
}

await rm(stageDir, { recursive: true, force: true });
await rm(profileDir, { recursive: true, force: true });
console.log(`screenshots written to ${outDir}`);
