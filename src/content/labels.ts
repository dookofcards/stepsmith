// Works out the visible label of an element for captions. Reads visible text
// and attributes only, never the value a user typed.
const BUTTON_INPUTS = new Set(["submit", "button", "reset"]);

const text = (el: Element | null): string =>
  el === null ? "" : ((el as HTMLElement).innerText ?? el.textContent ?? "").slice(0, 300);

function fieldLabel(field: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement): string {
  const fromLabel = text(field.labels?.[0] ?? null);
  if (fromLabel.trim() !== "") return fromLabel;
  const aria = field.getAttribute("aria-label");
  if (aria !== null && aria.trim() !== "") return aria;
  const by = field.getAttribute("aria-labelledby");
  if (by !== null) {
    const named = text(document.getElementById(by.split(/\s+/)[0] ?? ""));
    if (named.trim() !== "") return named;
  }
  const placeholder = field.getAttribute("placeholder");
  if (placeholder !== null && placeholder.trim() !== "") return placeholder;
  return field.getAttribute("name") ?? field.id;
}

export function captionLabelOf(start: Element): string {
  const el =
    start.closest(
      "button, a[href], [role=button], [role=link], [role=menuitem], [role=tab], summary, label, input, select, textarea",
    ) ?? start;
  const aria = el.getAttribute("aria-label");
  if (aria !== null && aria.trim() !== "") return aria;
  if (el instanceof HTMLInputElement) {
    // A button's value is its caption; any other input's value is user data.
    if (BUTTON_INPUTS.has(el.type.toLowerCase())) {
      return el.value || el.getAttribute("title") || "";
    }
    return fieldLabel(el);
  }
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
    return fieldLabel(el);
  }
  const visible = text(el);
  if (visible.trim() !== "") return visible;
  return (
    el.getAttribute("title") ??
    el.querySelector("img")?.getAttribute("alt") ??
    el.getAttribute("alt") ??
    ""
  );
}
