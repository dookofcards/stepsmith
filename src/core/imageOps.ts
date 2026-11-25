// Canvas operations on screenshots. OffscreenCanvas exists in both the
// service worker (capture-time highlight and blur) and extension pages
// (editor), so this one module serves both. Nothing here uses the network.
import { IMAGE_QUALITY } from "../shared/constants.ts";
import type { Rect } from "./geometry.ts";

export interface Rendered {
  blob: Blob;
  width: number;
  height: number;
}

const HIGHLIGHT = "#f97316";

function canvasFor(bitmap: ImageBitmap): {
  canvas: OffscreenCanvas;
  ctx: OffscreenCanvasRenderingContext2D;
} {
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext("2d");
  if (ctx === null) throw new Error("2D canvas unavailable");
  ctx.drawImage(bitmap, 0, 0);
  return { canvas, ctx };
}

async function finish(canvas: OffscreenCanvas): Promise<Rendered> {
  const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: IMAGE_QUALITY });
  return { blob, width: canvas.width, height: canvas.height };
}

/** Gaussian-blurs the pixels inside `rect` (image pixel coordinates). */
export function blurRect(
  ctx: OffscreenCanvasRenderingContext2D,
  source: ImageBitmap,
  rect: Rect,
): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(rect.x, rect.y, rect.w, rect.h);
  ctx.clip();
  // Radius scales with the box so small fields are unreadable too.
  ctx.filter = `blur(${Math.max(8, Math.round(Math.min(rect.w, rect.h) / 2))}px)`;
  ctx.drawImage(source, 0, 0);
  ctx.restore();
}

export function blackRect(ctx: OffscreenCanvasRenderingContext2D, rect: Rect): void {
  ctx.fillStyle = "#000";
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
}

export function outlineRect(
  ctx: OffscreenCanvasRenderingContext2D,
  rect: Rect,
  width: number,
  color = HIGHLIGHT,
): void {
  ctx.save();
  ctx.fillStyle = `${color}22`;
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  ctx.lineJoin = "round";
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = width + 3;
  ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
  ctx.restore();
}

export interface CaptureRender {
  /** Viewport size in CSS pixels at the moment of the click. */
  viewport: { w: number; h: number };
  /** Rectangles (CSS pixels) to blur: secret fields, plus Pro auto-blur. */
  blurs: Rect[];
  /** Rectangle (CSS pixels) to outline, or null. */
  highlight: Rect | null;
}

/** Bakes blur and highlight into a freshly captured screenshot. */
export async function renderCapture(
  source: Blob,
  spec: CaptureRender,
): Promise<Rendered> {
  const bitmap = await createImageBitmap(source);
  try {
    const { canvas, ctx } = canvasFor(bitmap);
    const scale = bitmap.width / Math.max(1, spec.viewport.w);
    for (const r of spec.blurs) {
      blurRect(ctx, bitmap, { x: r.x * scale, y: r.y * scale, w: r.w * scale, h: r.h * scale });
    }
    if (spec.highlight !== null) {
      const h = spec.highlight;
      outlineRect(
        ctx,
        { x: h.x * scale, y: h.y * scale, w: h.w * scale, h: h.h * scale },
        Math.max(3, Math.round(3 * scale)),
      );
    }
    return await finish(canvas);
  } finally {
    bitmap.close();
  }
}

export type EditOp =
  | { kind: "blur"; rect: Rect }
  | { kind: "black"; rect: Rect }
  | { kind: "box"; rect: Rect }
  | { kind: "arrow"; from: { x: number; y: number }; to: { x: number; y: number } }
  | { kind: "text"; at: { x: number; y: number }; text: string }
  | { kind: "crop"; rect: Rect };

/** Applies one editor operation (image pixel coordinates) and re-encodes. */
export async function applyEdit(source: Blob, op: EditOp): Promise<Rendered> {
  const bitmap = await createImageBitmap(source);
  try {
    if (op.kind === "crop") {
      const r = {
        x: Math.round(op.rect.x),
        y: Math.round(op.rect.y),
        w: Math.max(1, Math.round(op.rect.w)),
        h: Math.max(1, Math.round(op.rect.h)),
      };
      const canvas = new OffscreenCanvas(r.w, r.h);
      const ctx = canvas.getContext("2d");
      if (ctx === null) throw new Error("2D canvas unavailable");
      ctx.drawImage(bitmap, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
      return await finish(canvas);
    }
    const { canvas, ctx } = canvasFor(bitmap);
    const unit = Math.max(1, bitmap.width / 1000);
    switch (op.kind) {
      case "blur":
        blurRect(ctx, bitmap, op.rect);
        break;
      case "black":
        blackRect(ctx, op.rect);
        break;
      case "box":
        outlineRect(ctx, op.rect, Math.round(4 * unit), "#dc2626");
        break;
      case "arrow":
        drawArrow(ctx, op.from, op.to, 5 * unit);
        break;
      case "text":
        drawCallout(ctx, op.at, op.text, 22 * unit);
        break;
    }
    return await finish(canvas);
  } finally {
    bitmap.close();
  }
}

function drawArrow(
  ctx: OffscreenCanvasRenderingContext2D,
  from: { x: number; y: number },
  to: { x: number; y: number },
  width: number,
): void {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const head = width * 4;
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const [color, extra] of [["#fff", 3], ["#dc2626", 0]] as const) {
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = width + extra;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(to.x, to.y);
    ctx.lineTo(to.x - head * Math.cos(angle - 0.45), to.y - head * Math.sin(angle - 0.45));
    ctx.lineTo(to.x - head * Math.cos(angle + 0.45), to.y - head * Math.sin(angle + 0.45));
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

function drawCallout(
  ctx: OffscreenCanvasRenderingContext2D,
  at: { x: number; y: number },
  text: string,
  size: number,
): void {
  ctx.save();
  ctx.font = `600 ${size}px system-ui, sans-serif`;
  ctx.textBaseline = "top";
  const pad = size * 0.4;
  const width = ctx.measureText(text).width;
  ctx.fillStyle = "#dc2626";
  ctx.beginPath();
  ctx.roundRect(at.x, at.y, width + pad * 2, size + pad * 2, size * 0.3);
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.fillText(text, at.x + pad, at.y + pad);
  ctx.restore();
}

export async function decodeSize(blob: Blob): Promise<{ width: number; height: number }> {
  const bitmap = await createImageBitmap(blob);
  const size = { width: bitmap.width, height: bitmap.height };
  bitmap.close();
  return size;
}

export function dataUrlToBlob(dataUrl: string): Blob {
  const comma = dataUrl.indexOf(",");
  const meta = dataUrl.slice(5, comma);
  const mime = meta.split(";")[0] ?? "application/octet-stream";
  const binary = atob(dataUrl.slice(comma + 1));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("Could not read image"));
    reader.readAsDataURL(blob);
  });
}
