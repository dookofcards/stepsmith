// Renders each step to an A4 page image and wraps the pages in a PDF. Done
// on the device with canvas, so every language works and nothing is uploaded.
import { buildPdf, type PdfPage } from "../core/pdf.ts";
import { dataUrlToBlob } from "../core/imageOps.ts";
import { safeAccent, safeLogo, type Branding } from "../core/exporters.ts";
import type { Guide } from "../core/guide.ts";

const W = 1240; // A4 at 150 dpi
const H = 1754;
const MARGIN = 80;

interface PageImage {
  bitmap: ImageBitmap | null;
}

async function toBitmap(blob: Blob | undefined): Promise<ImageBitmap | null> {
  if (blob === undefined) return null;
  try {
    return await createImageBitmap(blob);
  } catch {
    return null;
  }
}

function drawCaption(
  ctx: OffscreenCanvasRenderingContext2D,
  caption: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
): number {
  // Split into words, remembering which are inside **bold**.
  const words: { text: string; bold: boolean }[] = [];
  let bold = false;
  for (const part of caption.split("**")) {
    for (const word of part.split(/\s+/).filter((w) => w !== "")) {
      words.push({ text: word, bold });
    }
    bold = !bold;
  }
  let cx = x;
  let cy = y;
  for (const word of words) {
    ctx.font = `${word.bold ? "700" : "400"} 34px system-ui, sans-serif`;
    const width = ctx.measureText(word.text + " ").width;
    if (cx + width > x + maxWidth && cx > x) {
      cx = x;
      cy += lineHeight;
    }
    ctx.fillText(word.text, cx, cy);
    cx += width;
  }
  return cy + lineHeight;
}

export async function renderPdf(
  guide: Guide,
  images: Map<string, Blob>,
  branding: Branding,
): Promise<Uint8Array> {
  const accent = safeAccent(branding.accent);
  const logoUrl = safeLogo(branding.logoDataUrl);
  let logo: ImageBitmap | null = null;
  if (logoUrl !== "") {
    logo = await toBitmap(dataUrlToBlob(logoUrl));
  }
  const total = Math.max(1, guide.steps.length);
  const pages: PdfPage[] = [];

  for (let i = 0; i < total; i++) {
    const step = guide.steps[i];
    const shot: PageImage = {
      bitmap: await toBitmap(step?.imageId == null ? undefined : images.get(step.imageId)),
    };
    const canvas = new OffscreenCanvas(W, H);
    const ctx = canvas.getContext("2d");
    if (ctx === null) throw new Error("2D canvas unavailable");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = accent;
    ctx.fillRect(0, 0, W, 14);

    let y = 70;
    if (logo !== null) {
      const scale = Math.min(1, 70 / logo.height);
      ctx.drawImage(logo, MARGIN, y - 20, logo.width * scale, logo.height * scale);
    }
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = "#6b7280";
    ctx.font = "400 28px system-ui, sans-serif";
    ctx.textAlign = "right";
    ctx.fillText(guide.title.slice(0, 70), W - MARGIN, y + 20);
    ctx.textAlign = "left";
    y += 110;

    if (step === undefined) {
      ctx.fillStyle = "#1f2937";
      ctx.font = "400 34px system-ui, sans-serif";
      ctx.fillText("This guide has no steps yet.", MARGIN, y + 40);
    } else {
      ctx.fillStyle = accent;
      ctx.beginPath();
      ctx.arc(MARGIN + 28, y + 14, 28, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.font = "700 32px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(String(i + 1), MARGIN + 28, y + 26);
      ctx.textAlign = "left";
      ctx.fillStyle = "#1f2937";
      y = drawCaption(ctx, step.caption, MARGIN + 80, y + 24, W - MARGIN * 2 - 80, 48);
      y += 30;
      if (shot.bitmap !== null) {
        const room = H - y - 170;
        const scale = Math.min((W - MARGIN * 2) / shot.bitmap.width, room / shot.bitmap.height);
        const w = shot.bitmap.width * scale;
        const h = shot.bitmap.height * scale;
        ctx.strokeStyle = "#d1d5db";
        ctx.lineWidth = 2;
        ctx.strokeRect(MARGIN - 1, y - 1, w + 2, h + 2);
        ctx.drawImage(shot.bitmap, MARGIN, y, w, h);
        shot.bitmap.close();
      }
    }

    ctx.fillStyle = "#6b7280";
    ctx.font = "400 26px system-ui, sans-serif";
    ctx.fillText(branding.footer.slice(0, 90), MARGIN, H - 70);
    ctx.textAlign = "right";
    ctx.fillText(`${i + 1} / ${total}`, W - MARGIN, H - 70);
    ctx.textAlign = "left";

    const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.9 });
    pages.push({ jpeg: new Uint8Array(await blob.arrayBuffer()), width: W, height: H });
  }
  logo?.close();
  return buildPdf(pages);
}
