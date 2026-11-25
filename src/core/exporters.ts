// Guide exporters. Pure string builders: the caller supplies image data.
import type { Guide } from "./guide.ts";

export interface Branding {
  /** #rrggbb */
  accent: string;
  footer: string;
  /** data:image/... URL, or "" for none. */
  logoDataUrl: string;
}

export const DEFAULT_ACCENT = "#4f46e5";

export const NO_BRANDING: Branding = {
  accent: DEFAULT_ACCENT,
  footer: "",
  logoDataUrl: "",
};

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Escapes first, then turns **x** into <strong>. Nothing else is markup. */
export function captionToHtml(caption: string): string {
  return escapeHtml(caption).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
}

export function safeAccent(value: string): string {
  return /^#[0-9a-fA-F]{6}$/.test(value) ? value : DEFAULT_ACCENT;
}

export function safeLogo(value: string): string {
  return /^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/.test(value)
    ? value
    : "";
}

/** A single self-contained HTML file: styles and screenshots are inlined. */
export function renderHtml(
  guide: Guide,
  images: Record<string, string>,
  branding: Branding = NO_BRANDING,
): string {
  const accent = safeAccent(branding.accent);
  const logo = safeLogo(branding.logoDataUrl);
  const steps = guide.steps
    .map((step, i) => {
      const src = step.imageId === null ? undefined : images[step.imageId];
      const img =
        src !== undefined && src.startsWith("data:image/")
          ? `<img src="${escapeHtml(src)}" alt="Screenshot for step ${i + 1}">`
          : "";
      return (
        `<section class="step"><h2><span class="n">${i + 1}</span>` +
        `${captionToHtml(step.caption)}</h2>${img}</section>`
      );
    })
    .join("\n");
  const footer =
    branding.footer.trim() === ""
      ? ""
      : `<footer>${escapeHtml(branding.footer.trim())}</footer>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(guide.title)}</title>
<style>
body{font:16px/1.5 system-ui,sans-serif;max-width:860px;margin:0 auto;padding:32px 20px;color:#1f2937}
header{border-bottom:3px solid ${accent};margin-bottom:24px;padding-bottom:12px}
header img{max-height:48px;display:block;margin-bottom:10px}
h1{margin:0;font-size:28px}
.step{margin:0 0 32px}
h2{font-size:19px;display:flex;gap:12px;align-items:flex-start}
.n{flex:none;background:${accent};color:#fff;border-radius:50%;width:30px;height:30px;display:inline-flex;align-items:center;justify-content:center;font-size:15px}
img{max-width:100%;border:1px solid #d1d5db;border-radius:8px}
footer{border-top:1px solid #d1d5db;padding-top:12px;color:#6b7280;font-size:14px}
</style>
</head>
<body>
<header>${logo === "" ? "" : `<img src="${logo}" alt="">`}<h1>${escapeHtml(guide.title)}</h1></header>
${steps}
${footer}
</body>
</html>
`;
}

/**
 * Markdown for wikis and READMEs. With `imagePaths` each step links its
 * screenshot; without it (the free copy-to-clipboard) steps are text only.
 */
export function renderMarkdown(
  guide: Guide,
  imagePaths?: Record<string, string>,
): string {
  const lines = [`# ${guide.title}`, ""];
  guide.steps.forEach((step, i) => {
    lines.push(`${i + 1}. ${step.caption}`);
    const path = step.imageId === null ? undefined : imagePaths?.[step.imageId];
    if (path !== undefined) lines.push("", `   ![Step ${i + 1}](${path})`);
    lines.push("");
  });
  return `${lines.join("\n").trimEnd()}\n`;
}

/** Filesystem-safe file name stem for a guide. */
export function fileStem(title: string): string {
  const stem = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return stem === "" ? "guide" : stem;
}
