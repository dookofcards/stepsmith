// Minimal PDF writer: one full-page JPEG per page. Pages are rendered to
// images by the editor (so any language, logo and accent colour just work),
// and this wraps them in a valid PDF 1.4 file. No library, no network.
import { concat } from "./zip.ts";

export interface PdfPage {
  jpeg: Uint8Array;
  /** Pixel size of the JPEG. */
  width: number;
  height: number;
}

/** A4 in PDF points. */
export const PAGE_WIDTH_PT = 595;
export const PAGE_HEIGHT_PT = 842;

export function buildPdf(pages: PdfPage[]): Uint8Array {
  if (pages.length === 0) throw new Error("A PDF needs at least one page");
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  const offsets: number[] = [];
  let size = 0;
  const push = (data: Uint8Array | string): void => {
    const bytes = typeof data === "string" ? encoder.encode(data) : data;
    parts.push(bytes);
    size += bytes.length;
  };
  const startObject = (id: number): void => {
    offsets[id] = size;
    push(`${id} 0 obj\n`);
  };

  push("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");

  // Object ids: 1 catalog, 2 pages, then three per page (page, content, image).
  const pageId = (i: number): number => 3 + i * 3;
  startObject(1);
  push("<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
  startObject(2);
  const kids = pages.map((_, i) => `${pageId(i)} 0 R`).join(" ");
  push(`<< /Type /Pages /Count ${pages.length} /Kids [${kids}] >>\nendobj\n`);

  pages.forEach((page, i) => {
    const id = pageId(i);
    startObject(id);
    push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH_PT} ${PAGE_HEIGHT_PT}] ` +
        `/Resources << /XObject << /Im0 ${id + 2} 0 R >> >> /Contents ${id + 1} 0 R >>\nendobj\n`,
    );
    const content = `q ${PAGE_WIDTH_PT} 0 0 ${PAGE_HEIGHT_PT} 0 0 cm /Im0 Do Q`;
    startObject(id + 1);
    push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`);
    startObject(id + 2);
    push(
      `<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} ` +
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.jpeg.length} >>\nstream\n`,
    );
    push(page.jpeg);
    push("\nendstream\nendobj\n");
  });

  const objectCount = 2 + pages.length * 3;
  const xrefAt = size;
  let xref = `xref\n0 ${objectCount + 1}\n0000000000 65535 f \n`;
  for (let id = 1; id <= objectCount; id++) {
    xref += `${String(offsets[id] ?? 0).padStart(10, "0")} 00000 n \n`;
  }
  push(xref);
  push(`trailer\n<< /Size ${objectCount + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`);
  return concat(parts);
}
