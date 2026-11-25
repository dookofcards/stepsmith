// The Stepsmith workspace: guide library, editor and settings, one page with
// a hash router. Also the screen that asks for recording permission, because
// that prompt needs an extension page that stays open (the popup closes).
import { createGuide, makeStep, addStep, type Guide } from "../core/guide.ts";
import { deleteGuide, getGuide, listGuides, saveGuide } from "../core/db.ts";
import { RECORDING_ORIGINS } from "../shared/constants.ts";
import { getEntitlement } from "../shared/features.ts";
import type {
  StartRecordingError,
  StartRecordingResponse,
} from "../shared/messages.ts";
import { formatDate, h } from "./dom.ts";
import { renderEditor } from "./editor.ts";
import { renderSettings } from "./settings.ts";

const view = document.getElementById("view") as HTMLElement;

const ERRORS: Record<StartRecordingError, string> = {
  needsPermission: "Stepsmith still needs permission to record sites.",
  unsupportedPage: "That page can't be recorded (browser pages, the Web Store and PDFs are off limits). Open a normal website and try again.",
  busy: "A recording is already running. Stop it first.",
  failed: "Could not start recording that tab.",
};

async function renderPermission(tabId: number, windowId: number): Promise<void> {
  const status = h("p", { id: "record-status", class: "note", hidden: true });
  const start = async (): Promise<void> => {
    status.hidden = false;
    status.textContent = "Starting…";
    const response = (await chrome.runtime.sendMessage({
      type: "startRecording",
      tabId,
      windowId,
    })) as StartRecordingResponse;
    if (!response.ok) {
      status.textContent = ERRORS[response.error];
      return;
    }
    history.replaceState(null, "", location.pathname + "#/");
    // Hand the user back to the page they are about to record.
    await chrome.tabs.update(tabId, { active: true });
    await chrome.windows.update(windowId, { focused: true });
    await render();
  };
  const allow = h("button", {
    class: "primary", id: "btn-allow",
    onClick: async () => {
      // Must run straight from this click: Chrome requires a user gesture.
      const granted = await chrome.permissions.request({ origins: RECORDING_ORIGINS });
      if (!granted) {
        status.hidden = false;
        status.textContent = "Without that permission Stepsmith can't record. Nothing was recorded.";
        return;
      }
      await start();
    },
  }, "Allow and start recording");
  const already = await chrome.permissions.contains({ origins: RECORDING_ORIGINS });
  view.replaceChildren(
    h("h1", {}, "Start recording"),
    h("p", { class: "lede" }, "Stepsmith records the clicks you make in this one tab and takes a screenshot for each, so it can build your guide."),
    h("div", { class: "card" },
      h("p", {}, "To keep recording after a click opens a new page, and to take those screenshots, Chrome needs you to allow Stepsmith to read and capture the sites you record. You will see Chrome's own prompt next."),
      h("ul", {},
        h("li", {}, "Only the tab you record is ever touched, and only while you record."),
        h("li", {}, "Typed text is never saved, only the name of the field. Password fields are never read and are blurred in screenshots."),
        h("li", {}, "Everything stays on this device.")),
      already ? h("button", { class: "primary", id: "btn-allow", onClick: () => void start() }, "Start recording") : allow,
      " ", h("a", { href: "#/" }, "Cancel"),
      status),
  );
}

async function renderLibrary(): Promise<void> {
  const guides = await listGuides();
  const newGuide = h("button", { id: "btn-new-guide", class: "primary", onClick: async () => {
    const guide: Guide = addStep(createGuide("New guide"), makeStep("text", "Describe this step", null));
    await saveGuide(guide);
    location.hash = `#/guide/${guide.id}`;
  } }, "New guide");
  const list = h("div", { id: "guide-list" });
  for (const guide of guides) list.append(guideCard(guide));
  view.replaceChildren(
    h("div", { class: "row" }, h("h1", {}, "Your guides"), h("span", { class: "spacer" }), newGuide),
    h("p", { class: "lede" }, "Everything here is stored on this device."),
    guides.length === 0
      ? h("div", { class: "card empty", id: "empty-state" },
          h("strong", {}, "Record your first guide"),
          h("ol", {},
            h("li", {}, "Open the website you want to document."),
            h("li", {}, "Click the Stepsmith toolbar button, then Record this tab."),
            h("li", {}, "Do the task as you normally would. Each click becomes a step with a screenshot."),
            h("li", {}, "Press Stop in the toolbar popup, then tidy the captions and export.")))
      : list,
  );
}

function guideCard(guide: Guide): HTMLElement {
  return h("div", { class: "card guide-card" },
    h("div", {},
      h("a", { class: "title", href: `#/guide/${guide.id}` }, guide.title),
      h("div", { class: "meta" }, `${guide.steps.length} steps · ${formatDate(guide.updatedAt)}`)),
    h("span", { class: "spacer" }),
    h("a", { href: `#/guide/${guide.id}` }, h("button", { class: "small" }, "Open")),
    h("button", { class: "small danger", onClick: async (e: Event) => {
      const button = e.target as HTMLButtonElement;
      if (button.dataset.armed !== "1") {
        button.dataset.armed = "1";
        button.textContent = "Click again to delete";
        return;
      }
      const full = await getGuide(guide.id);
      if (full !== undefined) await deleteGuide(full);
      await render();
    } }, "Delete"),
  );
}

async function render(): Promise<void> {
  const route = location.hash.replace(/^#/, "") || "/";
  for (const [id, path] of [["nav-guides", "/"], ["nav-settings", "/settings"]] as const) {
    document.getElementById(id)?.classList.toggle("current", route === path || (path === "/" && route.startsWith("/guide")));
  }
  const params = new URLSearchParams(location.search);
  const record = Number(params.get("record"));
  if (record > 0 && route === "/") {
    await renderPermission(record, Number(params.get("window")) || chrome.windows.WINDOW_ID_CURRENT);
    return;
  }
  if (route.startsWith("/guide/")) await renderEditor(view, route.slice("/guide/".length));
  else if (route === "/settings") await renderSettings(view);
  else await renderLibrary();
}

addEventListener("hashchange", () => void render());
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.proEntitlement !== undefined) void render();
  // A recording is adding steps to the guide being shown.
  if (area === "session" && changes.guidesRev !== undefined) {
    if (location.hash.startsWith("#/guide/") || location.hash === "" || location.hash === "#/") {
      const focused = document.activeElement;
      if (!(focused instanceof HTMLInputElement)) void render();
    }
  }
});
void getEntitlement().then(() => render());
