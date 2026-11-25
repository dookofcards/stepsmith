import { describe, expect, it } from "vitest";
import { addStep, createGuide, makeStep } from "../src/core/guide.ts";
import {
  captionToHtml,
  fileStem,
  renderHtml,
  renderMarkdown,
  safeAccent,
  safeLogo,
} from "../src/core/exporters.ts";
import { buildZip, crc32 } from "../src/core/zip.ts";
import { buildPdf } from "../src/core/pdf.ts";

const guide = () => {
  let g = createGuide("Reset <your> password");
  g = addStep(g, makeStep("click", "Click **Forgot password**", "img-1"));
  g = addStep(g, makeStep("text", "Check your inbox <script>alert(1)</script>", null));
  return g;
};

describe("html export", () => {
  it("contains every step, escaped, with images inlined", () => {
    const html = renderHtml(guide(), { "img-1": "data:image/jpeg;base64,AAAA" });
    expect(html).toContain("<strong>Forgot password</strong>");
    expect(html).toContain("Reset &lt;your&gt; password");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).toContain('src="data:image/jpeg;base64,AAAA"');
    expect(html.match(/class="step"/g)).toHaveLength(2);
    expect(html).toContain("default-src 'none'");
  });

  it("refuses non-image sources and bad branding values", () => {
    const html = renderHtml(guide(), { "img-1": "https://evil.example/x.png" });
    expect(html).not.toContain("evil.example");
    expect(safeAccent("red;}</style>")).toBe("#4f46e5");
    expect(safeAccent("#aabbcc")).toBe("#aabbcc");
    expect(safeLogo("javascript:alert(1)")).toBe("");
    expect(safeLogo("data:image/png;base64,iVBOR")).toBe("data:image/png;base64,iVBOR");
  });

  it("applies branding", () => {
    const html = renderHtml(guide(), {}, {
      accent: "#ff0000",
      footer: "Acme & Co",
      logoDataUrl: "data:image/png;base64,iVBOR",
    });
    expect(html).toContain("#ff0000");
    expect(html).toContain("<footer>Acme &amp; Co</footer>");
    expect(html).toContain('src="data:image/png;base64,iVBOR"');
  });

  it("only treats **x** as markup", () => {
    expect(captionToHtml("a *b* **c**")).toBe("a *b* <strong>c</strong>");
  });
});

describe("markdown export", () => {
  it("numbers steps and links images only when asked", () => {
    const plain = renderMarkdown(guide());
    expect(plain).toBe(
      "# Reset <your> password\n\n1. Click **Forgot password**\n\n2. Check your inbox <script>alert(1)</script>\n",
    );
    const withImages = renderMarkdown(guide(), { "img-1": "images/step-01.jpg" });
    expect(withImages).toContain("![Step 1](images/step-01.jpg)");
    expect(withImages).not.toContain("![Step 2]");
  });

  it("makes safe file names", () => {
    expect(fileStem("Reset <your> password!")).toBe("reset-your-password");
    expect(fileStem("***")).toBe("guide");
  });
});

describe("zip writer", () => {
  it("writes a readable archive with correct CRCs", () => {
    const enc = new TextEncoder();
    const zip = buildZip([
      { name: "guide.md", data: enc.encode("# Hi\n") },
      { name: "images/step-01.jpg", data: new Uint8Array([1, 2, 3, 4]) },
    ]);
    const view = new DataView(zip.buffer);
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    const eocd = zip.length - 22;
    expect(view.getUint32(eocd, true)).toBe(0x06054b50);
    expect(view.getUint16(eocd + 10, true)).toBe(2);
    expect(view.getUint32(view.getUint32(eocd + 16, true), true)).toBe(0x02014b50);
    expect(crc32(enc.encode("123456789"))).toBe(0xcbf43926);
    expect(new TextDecoder().decode(zip)).toContain("images/step-01.jpg");
  });
});

describe("pdf writer", () => {
  it("produces a valid structure with one page per image", () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    const pdf = buildPdf([
      { jpeg, width: 10, height: 10 },
      { jpeg, width: 10, height: 10 },
      { jpeg, width: 10, height: 10 },
    ]);
    const text = new TextDecoder("latin1").decode(pdf);
    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect(text.trimEnd().endsWith("%%EOF")).toBe(true);
    expect(text.match(/\/Type \/Page\b(?!s)/g)).toHaveLength(3);
    expect(text).toContain("/Count 3");
    const at = Number(/startxref\n(\d+)/.exec(text)![1]);
    expect(text.slice(at, at + 4)).toBe("xref");
    const entries = [...text.slice(at).matchAll(/(\d{10}) 00000 n /g)];
    expect(entries).toHaveLength(2 + 9);
    entries.forEach((m, i) => {
      const want = `${i + 1} 0 obj\n`;
      expect(text.slice(Number(m[1]), Number(m[1]) + want.length)).toBe(want);
    });
  });

  it("rejects an empty document", () => {
    expect(() => buildPdf([])).toThrow();
  });
});
