// Rectangle maths for highlights and redaction. Pure.
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Viewport {
  w: number;
  h: number;
}

/** Elements covering more of the viewport than this get a ring at the click. */
const LARGE_FRACTION = 0.35;
const RING_RADIUS = 28;

/**
 * What to outline for a click: the element's box, or — when the element is
 * huge (a page-wide container) or has no size — a ring around the pointer.
 */
export function highlightFor(
  element: Rect | null,
  point: { x: number; y: number },
  viewport: Viewport,
): Rect {
  const ring: Rect = {
    x: point.x - RING_RADIUS,
    y: point.y - RING_RADIUS,
    w: RING_RADIUS * 2,
    h: RING_RADIUS * 2,
  };
  if (element === null || element.w < 2 || element.h < 2) return ring;
  const area = element.w * element.h;
  if (area > viewport.w * viewport.h * LARGE_FRACTION) return ring;
  return element;
}

export function scaleRect(rect: Rect, scale: number): Rect {
  return { x: rect.x * scale, y: rect.y * scale, w: rect.w * scale, h: rect.h * scale };
}

/** Normalises a drag (any direction) into a positive-size rect inside bounds. */
export function normalizeDrag(
  a: { x: number; y: number },
  b: { x: number; y: number },
  bounds: Viewport,
): Rect {
  const x1 = Math.max(0, Math.min(a.x, b.x));
  const y1 = Math.max(0, Math.min(a.y, b.y));
  const x2 = Math.min(bounds.w, Math.max(a.x, b.x));
  const y2 = Math.min(bounds.h, Math.max(a.y, b.y));
  return { x: x1, y: y1, w: Math.max(0, x2 - x1), h: Math.max(0, y2 - y1) };
}

export function intersectsViewport(rect: Rect, viewport: Viewport): boolean {
  return (
    rect.w > 0 &&
    rect.h > 0 &&
    rect.x < viewport.w &&
    rect.y < viewport.h &&
    rect.x + rect.w > 0 &&
    rect.y + rect.h > 0
  );
}
