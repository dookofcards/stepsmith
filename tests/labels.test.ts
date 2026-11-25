import { describe, expect, it } from "vitest";
import { captionFor, cleanLabel, isSecretField, looksSensitive } from "../src/core/labels.ts";
import { highlightFor, intersectsViewport, normalizeDrag, scaleRect } from "../src/core/geometry.ts";

describe("labels", () => {
  it("cleans whitespace, markup characters and length", () => {
    expect(cleanLabel("  Save \n  changes ")).toBe("Save changes");
    expect(cleanLabel("**bold** <b>x</b>")).toBe("bold b x /b");
    expect(cleanLabel("a".repeat(100))).toHaveLength(60);
    expect(cleanLabel("a".repeat(100)).endsWith("…")).toBe(true);
  });

  it("builds captions with a bold target", () => {
    expect(captionFor("click", "Save")).toBe("Click **Save**");
    expect(captionFor("type", "Email")).toBe("Type in **Email**");
    expect(captionFor("go", "example.com")).toBe("Go to **example.com**");
    expect(captionFor("click", "  ")).toBe("Click the highlighted spot");
    expect(captionFor("type", "")).toBe("Type in the highlighted field");
  });

  it("treats passwords, codes and card fields as secret", () => {
    expect(isSecretField("password", "")).toBe(true);
    expect(isSecretField("PASSWORD", "")).toBe(true);
    expect(isSecretField("text", "cc-number")).toBe(true);
    expect(isSecretField("text", "section-x one-time-code")).toBe(true);
    expect(isSecretField("text", "email")).toBe(false);
    expect(isSecretField("text", "")).toBe(false);
  });

  it("spots emails and long numbers only", () => {
    expect(looksSensitive("jane.doe@example.com")).toBe("email");
    expect(looksSensitive("4242 4242 4242 4242")).toBe("number");
    expect(looksSensitive("+1 (555) 123-4567")).toBe("number");
    expect(looksSensitive("hello world")).toBe(null);
    expect(looksSensitive("12345")).toBe(null);
    expect(looksSensitive("order 123456789 shipped")).toBe(null);
  });
});

describe("geometry", () => {
  const viewport = { w: 1000, h: 800 };
  it("outlines small elements and rings huge ones", () => {
    const button = { x: 10, y: 20, w: 100, h: 30 };
    expect(highlightFor(button, { x: 50, y: 30 }, viewport)).toEqual(button);
    const huge = { x: 0, y: 0, w: 1000, h: 800 };
    const ring = highlightFor(huge, { x: 300, y: 300 }, viewport);
    expect(ring).toEqual({ x: 272, y: 272, w: 56, h: 56 });
    expect(highlightFor(null, { x: 300, y: 300 }, viewport)).toEqual(ring);
    expect(highlightFor({ x: 1, y: 1, w: 0, h: 10 }, { x: 300, y: 300 }, viewport)).toEqual(ring);
  });

  it("scales and normalises", () => {
    expect(scaleRect({ x: 1, y: 2, w: 3, h: 4 }, 2)).toEqual({ x: 2, y: 4, w: 6, h: 8 });
    expect(normalizeDrag({ x: 50, y: 60 }, { x: 10, y: 20 }, viewport)).toEqual({
      x: 10,
      y: 20,
      w: 40,
      h: 40,
    });
    expect(normalizeDrag({ x: -5, y: 0 }, { x: 2000, y: 10 }, viewport)).toEqual({
      x: 0,
      y: 0,
      w: 1000,
      h: 10,
    });
  });

  it("detects rects outside the viewport", () => {
    expect(intersectsViewport({ x: 5, y: 5, w: 10, h: 10 }, viewport)).toBe(true);
    expect(intersectsViewport({ x: 1200, y: 5, w: 10, h: 10 }, viewport)).toBe(false);
    expect(intersectsViewport({ x: 5, y: 5, w: 0, h: 10 }, viewport)).toBe(false);
  });
});
