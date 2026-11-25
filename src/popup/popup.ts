// The popup only starts and stops recording and lists recent guides. It
// never asks for permission itself: Chrome's prompt would close the popup, so
// that step lives on the workspace page.
import { listGuides } from "../core/db.ts";
import { RECORDING_ORIGINS } from "../shared/constants.ts";
import type {
  GetRecordingResponse,
  StartRecordingError,
  StartRecordingResponse,
} from "../shared/messages.ts";

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const appUrl = (hash = ""): string => chrome.runtime.getURL(`app/app.html${hash}`);

const ERRORS: Record<StartRecordingError, string> = {
  needsPermission: "Stepsmith still needs permission to record sites.",
  unsupportedPage: "This page can't be recorded. Open a normal website first.",
  busy: "A recording is already running.",
  failed: "Could not start recording this tab.",
};

async function openApp(hash = "", query = ""): Promise<void> {
  const url = chrome.runtime.getURL(`app/app.html${query}${hash}`);
  await chrome.tabs.create({ url });
  window.close();
}

async function refresh(): Promise<void> {
  const { recording } = (await chrome.runtime.sendMessage({
    type: "getRecording",
  })) as GetRecordingResponse;
  $("idle").hidden = recording !== null;
  $("recording").hidden = recording === null;
  if (recording !== null) $("step-count").textContent = String(recording.steps);

  const guides = (await listGuides()).slice(0, 5);
  $("none").hidden = guides.length > 0;
  const list = $("recent");
  list.replaceChildren(
    ...guides.map((guide) => {
      const li = document.createElement("li");
      const a = document.createElement("a");
      a.href = "#";
      a.textContent = guide.title;
      a.addEventListener("click", (e) => {
        e.preventDefault();
        void openApp(`#/guide/${guide.id}`);
      });
      const count = document.createElement("span");
      count.className = "count";
      count.textContent = `${guide.steps.length} steps`;
      li.append(a, count);
      return li;
    }),
  );
}

$("btn-record").addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined) return;
  const msg = $("msg");
  if (await chrome.permissions.contains({ origins: RECORDING_ORIGINS })) {
    const response = (await chrome.runtime.sendMessage({
      type: "startRecording",
      tabId: tab.id,
      windowId: tab.windowId,
    })) as StartRecordingResponse;
    if (response.ok) {
      window.close();
      return;
    }
    msg.hidden = false;
    msg.textContent = ERRORS[response.error];
    return;
  }
  await openApp("", `?record=${tab.id}&window=${tab.windowId}`);
});

$("btn-stop").addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "stopRecording", openEditor: true });
  window.close();
});
$("btn-settings").addEventListener("click", () => void openApp("#/settings"));
$("btn-open-app").addEventListener("click", (e) => {
  e.preventDefault();
  void openApp();
});

void refresh();
