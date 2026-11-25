// Tiny DOM helpers. Text is only ever set with textContent, never innerHTML.
type Child = Node | string | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Record<string, unknown> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === false) continue;
    if (key === "class") el.className = String(value);
    else if (key.startsWith("on") && typeof value === "function") {
      el.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
    } else if (key in el && key !== "list") {
      (el as unknown as Record<string, unknown>)[key] = value;
    } else el.setAttribute(key, String(value));
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    el.append(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return el;
}

/** Renders "Click **Save**" as text with <strong> for the bold part. */
export function captionNodes(caption: string): Node[] {
  const nodes: Node[] = [];
  const pattern = /\*\*(.+?)\*\*/g;
  let last = 0;
  for (const match of caption.matchAll(pattern)) {
    const at = match.index ?? 0;
    if (at > last) nodes.push(document.createTextNode(caption.slice(last, at)));
    nodes.push(h("strong", {}, match[1] ?? ""));
    last = at + match[0].length;
  }
  if (last < caption.length) nodes.push(document.createTextNode(caption.slice(last)));
  return nodes;
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = h("a", { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function formatDate(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
