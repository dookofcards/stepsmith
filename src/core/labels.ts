// Turning a clicked element into a caption, and deciding what must never be
// recorded. Pure functions, shared by the page recorder and the unit tests.

export const MAX_LABEL_LENGTH = 60;

/** Collapses whitespace, drops markdown/control characters, truncates. */
export function cleanLabel(raw: string, max = MAX_LABEL_LENGTH): string {
  const text = raw
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f*_`<>]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

export type CaptionKind = "go" | "click" | "type";

export function captionFor(kind: CaptionKind, label: string): string {
  const clean = cleanLabel(label);
  switch (kind) {
    case "go":
      return clean === "" ? "Open the page" : `Go to **${clean}**`;
    case "click":
      return clean === "" ? "Click the highlighted spot" : `Click **${clean}**`;
    case "type":
      return clean === "" ? "Type in the highlighted field" : `Type in **${clean}**`;
  }
}

const AUTOCOMPLETE_SECRETS = new Set([
  "current-password",
  "new-password",
  "one-time-code",
  "cc-number",
  "cc-csc",
  "cc-exp",
  "cc-exp-month",
  "cc-exp-year",
]);

/**
 * Fields whose contents are always blurred in screenshots and whose value is
 * never read: passwords, one-time codes and card details. Safety is free.
 */
export function isSecretField(type: string, autocomplete: string): boolean {
  if (type.toLowerCase() === "password") return true;
  return autocomplete
    .toLowerCase()
    .split(/\s+/)
    .some((token) => AUTOCOMPLETE_SECRETS.has(token));
}

const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]{2,}/;

/**
 * Pro auto-blur: does this field value look like an email address or a long
 * number (card, phone, account, ID)? The caller only ever sends back a
 * rectangle, never the value.
 */
export function looksSensitive(value: string): "email" | "number" | null {
  if (EMAIL.test(value)) return "email";
  const digits = value.replace(/\D/g, "").length;
  if (digits >= 9 && /^[\d\s().+-]+$/.test(value.trim())) return "number";
  return null;
}
