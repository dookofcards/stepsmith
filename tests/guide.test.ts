import { describe, expect, it } from "vitest";
import {
  addStep,
  createGuide,
  deleteStep,
  imageIdsOf,
  makeStep,
  moveStep,
  setCaption,
  setImage,
  setTitle,
} from "../src/core/guide.ts";

const build = () => {
  let guide = createGuide("My guide", 1);
  for (const c of ["one", "two", "three"]) {
    guide = addStep(guide, makeStep("text", c, null), 2);
  }
  return guide;
};

describe("guide operations", () => {
  it("creates a guide with a default title", () => {
    expect(createGuide("   ").title).toBe("Untitled guide");
    expect(createGuide("x".repeat(500)).title).toHaveLength(120);
  });

  it("adds steps in order and bumps updatedAt", () => {
    const guide = build();
    expect(guide.steps.map((s) => s.caption)).toEqual(["one", "two", "three"]);
    expect(guide.updatedAt).toBe(2);
  });

  it("moves steps and ignores out-of-range moves", () => {
    const guide = build();
    const [a, b, c] = guide.steps;
    const down = moveStep(guide, a!.id, 1);
    expect(down.steps.map((s) => s.id)).toEqual([b!.id, a!.id, c!.id]);
    const up = moveStep(guide, c!.id, -2);
    expect(up.steps.map((s) => s.id)).toEqual([c!.id, a!.id, b!.id]);
    expect(moveStep(guide, a!.id, -1)).toBe(guide);
    expect(moveStep(guide, c!.id, 1)).toBe(guide);
    expect(moveStep(guide, "nope", 1)).toBe(guide);
  });

  it("deletes and edits without mutating the original", () => {
    const guide = build();
    const id = guide.steps[1]!.id;
    expect(deleteStep(guide, id).steps).toHaveLength(2);
    expect(guide.steps).toHaveLength(3);
    const edited = setCaption(guide, id, "  Click   **Save** ");
    expect(edited.steps[1]!.caption).toBe("Click **Save**");
    expect(guide.steps[1]!.caption).toBe("two");
  });

  it("tracks image ids", () => {
    let guide = build();
    guide = setImage(guide, guide.steps[0]!.id, "img-1");
    guide = setImage(guide, guide.steps[2]!.id, "img-3");
    expect(imageIdsOf(guide)).toEqual(["img-1", "img-3"]);
    guide = setImage(guide, guide.steps[0]!.id, null);
    expect(imageIdsOf(guide)).toEqual(["img-3"]);
  });

  it("renames", () => {
    expect(setTitle(build(), " New ").title).toBe("New");
    expect(setTitle(build(), "").title).toBe("Untitled guide");
  });
});
