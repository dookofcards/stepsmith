import { NO_BRANDING, type Branding, safeAccent, safeLogo } from "../core/exporters.ts";
import { blobToDataUrl } from "../core/imageOps.ts";
import { hasFeature } from "../shared/features.ts";

const KEY = "branding";
const MAX_LOGO_EDGE = 320;

export async function getStoredBranding(): Promise<Branding> {
  const stored = await chrome.storage.local.get(KEY);
  const saved = stored[KEY] as Partial<Branding> | undefined;
  return {
    accent: safeAccent(saved?.accent ?? NO_BRANDING.accent),
    footer: (saved?.footer ?? "").slice(0, 200),
    logoDataUrl: safeLogo(saved?.logoDataUrl ?? ""),
  };
}

export async function saveBranding(branding: Branding): Promise<void> {
  await chrome.storage.local.set({
    [KEY]: {
      accent: safeAccent(branding.accent),
      footer: branding.footer.slice(0, 200),
      logoDataUrl: safeLogo(branding.logoDataUrl),
    },
  });
}

/** Branding applied to an export: the saved one with Pro, none without. */
export async function brandingForExport(): Promise<Branding> {
  return (await hasFeature("branding")) ? getStoredBranding() : NO_BRANDING;
}

/** Shrinks an uploaded logo so it stays small in storage and in exports. */
export async function logoFromFile(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_LOGO_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = new OffscreenCanvas(
    Math.max(1, Math.round(bitmap.width * scale)),
    Math.max(1, Math.round(bitmap.height * scale)),
  );
  const ctx = canvas.getContext("2d");
  if (ctx === null) throw new Error("2D canvas unavailable");
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return blobToDataUrl(await canvas.convertToBlob({ type: "image/png" }));
}
