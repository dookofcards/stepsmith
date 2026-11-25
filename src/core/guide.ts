// Guide model and the pure operations on it. Everything here is
// side-effect free so it can be unit tested without a browser; persistence
// lives in db.ts.

export type StepKind = "go" | "click" | "type" | "text";

export interface Step {
  id: string;
  kind: StepKind;
  /** Light markdown: only **bold** is meaningful. Edited by the user. */
  caption: string;
  /** Key into the images store, or null for text-only steps. */
  imageId: string | null;
}

export interface Guide {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  steps: Step[];
}

export const MAX_CAPTION_LENGTH = 500;
export const MAX_TITLE_LENGTH = 120;

export function newId(): string {
  return crypto.randomUUID();
}

export function createGuide(title: string, now = Date.now()): Guide {
  return {
    id: newId(),
    title: clampText(title, MAX_TITLE_LENGTH) || "Untitled guide",
    createdAt: now,
    updatedAt: now,
    steps: [],
  };
}

export function clampText(text: string, max: number): string {
  return text.replace(/\s+/g, " ").trim().slice(0, max);
}

export function makeStep(
  kind: StepKind,
  caption: string,
  imageId: string | null,
): Step {
  return { id: newId(), kind, caption: clampText(caption, MAX_CAPTION_LENGTH), imageId };
}

const touch = (guide: Guide, steps: Step[], now: number): Guide => ({
  ...guide,
  steps,
  updatedAt: now,
});

export function addStep(guide: Guide, step: Step, now = Date.now()): Guide {
  return touch(guide, [...guide.steps, step], now);
}

export function deleteStep(guide: Guide, stepId: string, now = Date.now()): Guide {
  return touch(
    guide,
    guide.steps.filter((s) => s.id !== stepId),
    now,
  );
}

/** Moves a step by `delta` places (-1 = earlier). Out-of-range is a no-op. */
export function moveStep(
  guide: Guide,
  stepId: string,
  delta: number,
  now = Date.now(),
): Guide {
  const from = guide.steps.findIndex((s) => s.id === stepId);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= guide.steps.length) return guide;
  const steps = [...guide.steps];
  const [moved] = steps.splice(from, 1);
  if (moved === undefined) return guide;
  steps.splice(to, 0, moved);
  return touch(guide, steps, now);
}

export function setCaption(
  guide: Guide,
  stepId: string,
  caption: string,
  now = Date.now(),
): Guide {
  return touch(
    guide,
    guide.steps.map((s) =>
      s.id === stepId ? { ...s, caption: clampText(caption, MAX_CAPTION_LENGTH) } : s,
    ),
    now,
  );
}

export function setImage(
  guide: Guide,
  stepId: string,
  imageId: string | null,
  now = Date.now(),
): Guide {
  return touch(
    guide,
    guide.steps.map((s) => (s.id === stepId ? { ...s, imageId } : s)),
    now,
  );
}

export function setTitle(guide: Guide, title: string, now = Date.now()): Guide {
  return {
    ...guide,
    title: clampText(title, MAX_TITLE_LENGTH) || "Untitled guide",
    updatedAt: now,
  };
}

/** Image ids referenced by a guide (for cleaning up when it is deleted). */
export function imageIdsOf(guide: Guide): string[] {
  return guide.steps.flatMap((s) => (s.imageId === null ? [] : [s.imageId]));
}
