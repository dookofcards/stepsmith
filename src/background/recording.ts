// Recording sessions. The service worker can be killed at any time, so the
// session lives in chrome.storage.session and every handler re-reads it.
import { captionFor } from "../core/labels.ts";
import { addStep, createGuide, makeStep, newId, type Guide } from "../core/guide.ts";
import { getGuide, saveGuide, saveImage } from "../core/db.ts";
import { dataUrlToBlob, renderCapture } from "../core/imageOps.ts";
import type { Rect } from "../core/geometry.ts";
import { MIN_CAPTURE_GAP_MS, RECORDING_ORIGINS } from "../shared/constants.ts";
import { hasFeature } from "../shared/features.ts";
import { serialized } from "../shared/lock.ts";
import type {
  CollectBlursResponse,
  RecorderStepsMessage,
  RecorderStepsResponse,
  RecordingState,
  StartRecordingResponse,
  StopRecordingResponse,
} from "../shared/messages.ts";

const STATE_KEY = "recording";
const REV_KEY = "guidesRev";

export async function getRecording(): Promise<RecordingState | null> {
  const stored = await chrome.storage.session.get(STATE_KEY);
  return (stored[STATE_KEY] as RecordingState | undefined) ?? null;
}

async function setRecording(state: RecordingState | null): Promise<void> {
  if (state === null) await chrome.storage.session.remove(STATE_KEY);
  else await chrome.storage.session.set({ [STATE_KEY]: state });
  await chrome.action.setBadgeBackgroundColor({ color: "#dc2626" });
  await chrome.action.setBadgeText({ text: state === null ? "" : "REC" });
}

/** Lets open editor pages know a guide changed (they watch this key). */
async function bumpRevision(): Promise<void> {
  await chrome.storage.session.set({ [REV_KEY]: Date.now() });
}

let lastCaptureAt = 0;

/** captureVisibleTab is limited to about two calls a second. */
async function capture(windowId: number): Promise<Blob | null> {
  const wait = lastCaptureAt + MIN_CAPTURE_GAP_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCaptureAt = Date.now();
  try {
    const url = await chrome.tabs.captureVisibleTab(windowId, { format: "png" });
    return dataUrlToBlob(url);
  } catch {
    // Typically a click that navigates away before the screenshot is read
    // back. The step is still recorded, just without an image.
    return null;
  }
}

/**
 * captureVisibleTab shoots whatever tab is active in the window. Recording
 * starts from Stepsmith's own page, so bring the recorded tab to the front
 * and wait until Chrome reports it active before the opening screenshot;
 * otherwise that step got no image or a picture of Stepsmith itself.
 */
async function bringToFront(tabId: number, windowId: number): Promise<boolean> {
  try {
    await chrome.tabs.update(tabId, { active: true });
  } catch {
    return false;
  }
  for (let i = 0; i < 40; i++) {
    const [active] = await chrome.tabs.query({ active: true, windowId });
    if (active?.id === tabId) {
      await new Promise((r) => setTimeout(r, 150)); // let it paint
      return true;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  return false;
}

async function inject(tabId: number): Promise<boolean> {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content/recorder.js"],
      injectImmediately: true,
    });
    return true;
  } catch {
    return false; // error pages, the web store, PDFs viewer…
  }
}

interface StepSpec {
  kind: "go" | "click" | "type";
  caption: string;
  highlight: Rect | null;
}

/** Stores one capture as one image per step (each with its own highlight). */
async function storeSteps(
  guide: Guide,
  source: Blob | null,
  specs: StepSpec[],
  blurs: Rect[],
  viewport: { w: number; h: number },
): Promise<Guide> {
  let current = guide;
  for (const spec of specs) {
    let imageId: string | null = null;
    if (source !== null) {
      try {
        const rendered = await renderCapture(source, {
          viewport,
          blurs,
          highlight: spec.highlight,
        });
        imageId = newId();
        await saveImage({ id: imageId, ...rendered });
      } catch {
        imageId = null;
      }
    }
    current = addStep(current, makeStep(spec.kind, spec.caption, imageId));
  }
  await saveGuide(current);
  return current;
}

export function startRecording(
  tabId: number,
  windowId: number,
): Promise<StartRecordingResponse> {
  return serialized(async () => {
    const existing = await getRecording();
    if (existing !== null) {
      try {
        await chrome.tabs.get(existing.tabId);
        return { ok: false, error: "busy" } as const;
      } catch {
        await setRecording(null); // its tab is gone: stale session
      }
    }
    if (!(await chrome.permissions.contains({ origins: RECORDING_ORIGINS }))) {
      return { ok: false, error: "needsPermission" } as const;
    }
    let tab: chrome.tabs.Tab;
    try {
      tab = await chrome.tabs.get(tabId);
    } catch {
      return { ok: false, error: "failed" } as const;
    }
    let url: URL;
    try {
      url = new URL(tab.url ?? "");
    } catch {
      return { ok: false, error: "unsupportedPage" } as const;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return { ok: false, error: "unsupportedPage" } as const;
    }
    if (!(await inject(tabId))) return { ok: false, error: "unsupportedPage" } as const;

    const title = (tab.title ?? "").trim() || url.hostname;
    const guide = createGuide(title);
    await saveGuide(guide);
    await setRecording({
      guideId: guide.id,
      tabId,
      windowId: tab.windowId || windowId,
      steps: 0,
      startedAt: Date.now(),
    });

    // The opening step: what the page looked like when recording began.
    let collected: CollectBlursResponse = {
      blurs: [],
      piiBlurs: [],
      viewport: { w: tab.width ?? 1280, h: tab.height ?? 800 },
    };
    try {
      collected = (await chrome.tabs.sendMessage(tabId, {
        type: "collectBlurs",
      })) as CollectBlursResponse;
    } catch {
      // Keep the defaults; the first screenshot just won't blur anything.
    }
    const blurs = (await hasFeature("autoBlur"))
      ? [...collected.blurs, ...collected.piiBlurs]
      : collected.blurs;
    const shotWindow = tab.windowId || windowId;
    // Nothing is navigating yet, so a failed capture here is transient (the
    // tab still painting, or the rate limit): try a few times.
    let shot: Blob | null = null;
    if (await bringToFront(tabId, shotWindow)) {
      for (let attempt = 0; attempt < 3 && shot === null; attempt++) {
        shot = await capture(shotWindow);
      }
    }
    const saved = await storeSteps(
      guide,
      shot,
      [{ kind: "go", caption: captionFor("go", url.hostname), highlight: null }],
      blurs,
      collected.viewport,
    );
    await setRecording({
      guideId: guide.id,
      tabId,
      windowId: tab.windowId || windowId,
      steps: saved.steps.length,
      startedAt: Date.now(),
    });
    await bumpRevision();
    return { ok: true, guideId: guide.id } as const;
  });
}

export function handleRecorderSteps(
  message: RecorderStepsMessage,
  senderTabId: number | undefined,
): Promise<RecorderStepsResponse> {
  return serialized(async () => {
    const state = await getRecording();
    if (state === null || senderTabId !== state.tabId) return { ok: false, stop: true };
    const guide = await getGuide(state.guideId);
    if (guide === undefined) return { ok: false, stop: true };

    const blurs = (await hasFeature("autoBlur"))
      ? [...message.blurs, ...message.piiBlurs]
      : message.blurs;
    const shot = await capture(state.windowId);
    const saved = await storeSteps(
      guide,
      shot,
      message.steps.map((s) => ({
        kind: s.kind,
        caption: captionFor(s.kind, s.label),
        highlight: s.highlight,
      })),
      blurs,
      message.viewport,
    );
    await setRecording({ ...state, steps: saved.steps.length });
    await bumpRevision();
    return { ok: true };
  });
}

/** Re-attaches the recorder after the recorded tab loads a new page. */
export async function onTabUpdated(
  tabId: number,
  changeInfo: chrome.tabs.TabChangeInfo,
): Promise<void> {
  if (changeInfo.status !== "loading" && changeInfo.status !== "complete") return;
  const state = await getRecording();
  if (state === null || state.tabId !== tabId) return;
  await inject(tabId); // idempotent: the script guards against double attach
}

export function stopRecording(): Promise<StopRecordingResponse> {
  return serialized(async () => {
    const state = await getRecording();
    if (state === null) return { guideId: null, steps: 0 };
    try {
      await chrome.tabs.sendMessage(state.tabId, { type: "stopRecorder" });
    } catch {
      // The tab is closed or navigated somewhere we can't reach.
    }
    await setRecording(null);
    await bumpRevision();
    return { guideId: state.guideId, steps: state.steps };
  });
}

export async function onTabRemoved(tabId: number): Promise<void> {
  const state = await getRecording();
  if (state !== null && state.tabId === tabId) await stopRecording();
}
