// Page recorder, injected with chrome.scripting only into the one tab being
// recorded (never declared in the manifest). It reports clicks and the
// *labels* of fields you type into. It never reads a typed value, and it
// never touches the value of password, one-time-code or card fields.
import { captionLabelOf } from "./labels.ts";
import { highlightFor, intersectsViewport, type Rect } from "../core/geometry.ts";
import { isSecretField, looksSensitive } from "../core/labels.ts";
import type {
  CollectBlursResponse,
  RecorderStep,
  RecorderStepsMessage,
  RecorderStepsResponse,
} from "../shared/messages.ts";

const FLAG = "__stepsmithRecorder";
const scope = globalThis as unknown as Record<string, unknown>;

if (scope[FLAG] === undefined) {
  scope[FLAG] = true;
  start();
}

type TextField = HTMLInputElement | HTMLTextAreaElement;

const NON_TEXT_INPUTS = new Set([
  "checkbox", "radio", "button", "submit", "reset", "file",
  "range", "color", "image", "hidden",
]);

function isTextField(el: EventTarget | null): el is TextField {
  if (el instanceof HTMLTextAreaElement) return true;
  return el instanceof HTMLInputElement && !NON_TEXT_INPUTS.has(el.type.toLowerCase());
}

function boxOf(el: Element, pad = 2): Rect | null {
  const r = el.getBoundingClientRect();
  const rect = { x: r.left - pad, y: r.top - pad, w: r.width + pad * 2, h: r.height + pad * 2 };
  return intersectsViewport(rect, { w: innerWidth, h: innerHeight }) ? rect : null;
}

function collect(): CollectBlursResponse {
  const blurs: Rect[] = [];
  const piiBlurs: Rect[] = [];
  for (const el of document.querySelectorAll("input, textarea")) {
    const field = el as TextField;
    const rect = boxOf(field);
    if (rect === null) continue;
    if (isSecretField(field instanceof HTMLInputElement ? field.type : "", field.autocomplete)) {
      blurs.push(rect);
    } else if (isTextField(field) && looksSensitive(field.value) !== null) {
      // Only whether it looks sensitive leaves this function, as a rectangle.
      piiBlurs.push(rect);
    }
  }
  return { blurs, piiBlurs, viewport: { w: innerWidth, h: innerHeight } };
}

function start(): void {
  let dirty: TextField | null = null;
  let attached = true;

  const typeStep = (field: TextField): RecorderStep => ({
    kind: "type",
    label: captionLabelOf(field),
    highlight: boxOf(field, 3) ?? { x: 0, y: 0, w: 0, h: 0 },
  });

  const send = (steps: RecorderStep[]): void => {
    const { blurs, piiBlurs, viewport } = collect();
    const message: RecorderStepsMessage = {
      type: "recorderSteps",
      steps,
      blurs,
      piiBlurs,
      viewport,
    };
    chrome.runtime
      .sendMessage(message)
      .then((response: RecorderStepsResponse | undefined) => {
        if (response?.stop === true) detach();
      })
      .catch(() => detach()); // extension reloaded or updated
  };

  const flushTyping = (): RecorderStep[] => {
    if (dirty === null) return [];
    const step = typeStep(dirty);
    dirty = null;
    return [step];
  };

  const onPointerDown = (event: PointerEvent): void => {
    if (!event.isTrusted || event.button !== 0) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    const steps = flushTyping();
    steps.push(clickStep(target, event.clientX, event.clientY));
    send(steps);
  };

  const onKeyboardClick = (event: MouseEvent): void => {
    // Enter/Space on a focused control: a click with no pointer (detail 0).
    if (!event.isTrusted || event.detail !== 0) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    const box = target.getBoundingClientRect();
    const steps = flushTyping();
    steps.push(clickStep(target, box.left + box.width / 2, box.top + box.height / 2));
    send(steps);
  };

  const onInput = (event: Event): void => {
    if (event.isTrusted && isTextField(event.target)) dirty = event.target;
  };

  const flushNow = (): void => {
    const steps = flushTyping();
    if (steps.length > 0) send(steps);
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.isTrusted && event.key === "Enter") flushNow();
  };

  const onMessage = (message: { type?: string }): undefined => {
    if (message.type === "stopRecorder") detach();
    return undefined;
  };

  function detach(): void {
    if (!attached) return;
    attached = false;
    removeEventListener("pointerdown", onPointerDown, true);
    removeEventListener("click", onKeyboardClick, true);
    removeEventListener("input", onInput, true);
    removeEventListener("change", flushNow, true);
    removeEventListener("keydown", onKeyDown, true);
    chrome.runtime.onMessage.removeListener(onMessage);
    chrome.runtime.onMessage.removeListener(onCollect);
    delete scope[FLAG];
  }

  const onCollect = (
    message: { type?: string },
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response: CollectBlursResponse) => void,
  ): undefined => {
    if (message.type === "collectBlurs") sendResponse(collect());
    return undefined;
  };

  addEventListener("pointerdown", onPointerDown, true);
  addEventListener("click", onKeyboardClick, true);
  addEventListener("input", onInput, true);
  addEventListener("change", flushNow, true);
  addEventListener("keydown", onKeyDown, true);
  chrome.runtime.onMessage.addListener(onMessage);
  chrome.runtime.onMessage.addListener(onCollect);
}

function clickStep(target: Element, x: number, y: number): RecorderStep {
  const box = interactiveAncestor(target).getBoundingClientRect();
  const element: Rect = { x: box.left - 3, y: box.top - 3, w: box.width + 6, h: box.height + 6 };
  return {
    kind: "click",
    label: captionLabelOf(target),
    highlight: highlightFor(element, { x, y }, { w: innerWidth, h: innerHeight }),
  };
}

function interactiveAncestor(el: Element): Element {
  return (
    el.closest(
      "button, a[href], [role=button], [role=link], [role=menuitem], [role=tab], summary, label, input, select, textarea",
    ) ?? el
  );
}
