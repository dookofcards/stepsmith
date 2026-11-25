// Pro: redact and annotate a step's screenshot. Drag on the image to apply a
// tool; every edit rewrites the stored image, with one-step undo while the
// editor is open.
import { normalizeDrag, type Rect } from "../core/geometry.ts";
import { applyEdit, type EditOp } from "../core/imageOps.ts";
import { hasFeature, type ProFeature } from "../shared/features.ts";
import { h } from "./dom.ts";

type Tool = "blur" | "black" | "box" | "arrow" | "text" | "crop";

const TOOLS: { id: Tool; label: string; feature: ProFeature }[] = [
  { id: "blur", label: "Blur", feature: "redaction" },
  { id: "black", label: "Black out", feature: "redaction" },
  { id: "box", label: "Box", feature: "annotate" },
  { id: "arrow", label: "Arrow", feature: "annotate" },
  { id: "text", label: "Text", feature: "annotate" },
  { id: "crop", label: "Crop", feature: "annotate" },
];

export interface ImageEditorHooks {
  img: HTMLImageElement;
  current: () => Blob;
  /** Persist the new image and refresh the preview. */
  commit: (blob: Blob) => Promise<void>;
}

export function createImageEditor(hooks: ImageEditorHooks): {
  toolbar: HTMLElement;
  overlay: HTMLElement;
} {
  let tool: Tool = "blur";
  const undo: Blob[] = [];
  const status = h("span", { class: "status" });
  const textInput = h("input", {
    type: "text",
    placeholder: "Callout text",
    value: "Look here",
    class: "edit-text",
  });
  const buttons = new Map<Tool, HTMLButtonElement>();
  const undoButton = h("button", { class: "small edit-undo", disabled: true }, "Undo");

  const selectTool = (next: Tool): void => {
    tool = next;
    for (const [id, button] of buttons) button.classList.toggle("on", id === next);
    status.textContent =
      next === "text"
        ? "Type your text, then click where it should go."
        : next === "arrow"
          ? "Drag from the tail to the point."
          : "Drag over the area.";
  };

  for (const spec of TOOLS) {
    const button = h(
      "button",
      { class: `small tool-${spec.id}`, onClick: () => selectTool(spec.id) },
      spec.label,
    );
    buttons.set(spec.id, button);
  }
  selectTool("blur");

  undoButton.addEventListener("click", () => {
    const previous = undo.pop();
    if (previous === undefined) return;
    void hooks.commit(previous).then(() => {
      undoButton.disabled = undo.length === 0;
    });
  });

  const toolbar = h(
    "div",
    { class: "toolbar edit-toolbar" },
    ...buttons.values(),
    textInput,
    undoButton,
    status,
  );

  const overlay = h("div", { class: "overlay" });
  const selection = h("div", { class: "selection" });
  selection.style.display = "none";
  overlay.append(selection);

  let start: { x: number; y: number } | null = null;
  const local = (event: PointerEvent): { x: number; y: number } => {
    const box = hooks.img.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(box.width, event.clientX - box.left)),
      y: Math.max(0, Math.min(box.height, event.clientY - box.top)),
    };
  };
  const toImage = (p: { x: number; y: number }): { x: number; y: number } => {
    const box = hooks.img.getBoundingClientRect();
    const scale = hooks.img.naturalWidth / Math.max(1, box.width);
    return { x: p.x * scale, y: p.y * scale };
  };

  const run = async (op: EditOp, feature: ProFeature): Promise<void> => {
    // Checked again here, not just when the buttons were drawn.
    if (!(await hasFeature(feature))) {
      status.textContent = "This tool is part of Stepsmith Pro.";
      return;
    }
    try {
      const before = hooks.current();
      const next = await applyEdit(before, op);
      undo.push(before);
      undoButton.disabled = false;
      await hooks.commit(next.blob);
      status.textContent = "Applied.";
    } catch (error) {
      status.textContent = `Could not apply: ${error instanceof Error ? error.message : String(error)}`;
    }
  };

  overlay.addEventListener("pointerdown", (event) => {
    try {
      overlay.setPointerCapture(event.pointerId);
    } catch {
      // Capture is a nicety (keeps the drag going outside the image).
    }
    start = local(event);
    if (tool === "text") {
      const text = textInput.value.trim();
      const at = toImage(start);
      start = null;
      if (text !== "") void run({ kind: "text", at, text }, "annotate");
      return;
    }
    selection.style.display = "block";
    Object.assign(selection.style, { left: `${start.x}px`, top: `${start.y}px`, width: "0px", height: "0px" });
  });

  overlay.addEventListener("pointermove", (event) => {
    if (start === null) return;
    const box = hooks.img.getBoundingClientRect();
    const r = normalizeDrag(start, local(event), { w: box.width, h: box.height });
    Object.assign(selection.style, {
      left: `${r.x}px`,
      top: `${r.y}px`,
      width: `${r.w}px`,
      height: `${r.h}px`,
    });
  });

  overlay.addEventListener("pointerup", (event) => {
    if (start === null) return;
    const from = start;
    const to = local(event);
    start = null;
    selection.style.display = "none";
    const a = toImage(from);
    const b = toImage(to);
    if (Math.abs(b.x - a.x) < 4 && Math.abs(b.y - a.y) < 4) return;
    const rect: Rect = normalizeDrag(a, b, {
      w: hooks.img.naturalWidth,
      h: hooks.img.naturalHeight,
    });
    const spec = TOOLS.find((t) => t.id === tool);
    if (spec === undefined) return;
    const op: EditOp =
      tool === "arrow" ? { kind: "arrow", from: a, to: b } : { kind: tool as "blur", rect };
    void run(op, spec.feature);
  });

  return { toolbar, overlay };
}
