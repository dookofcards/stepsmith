// The guide editor: edit captions, reorder and delete steps, export.
import {
  addStep, deleteStep, makeStep, moveStep, setCaption, setTitle,
  type Guide, type Step,
} from "../core/guide.ts";
import { getGuide, getImage, saveGuide, saveImage, deleteImages } from "../core/db.ts";
import { blobToDataUrl, decodeSize } from "../core/imageOps.ts";
import { fileStem, renderHtml, renderMarkdown } from "../core/exporters.ts";
import { buildZip } from "../core/zip.ts";
import { hasFeature } from "../shared/features.ts";
import type { GetRecordingResponse } from "../shared/messages.ts";
import { brandingForExport } from "./branding.ts";
import { downloadBlob, h } from "./dom.ts";
import { createImageEditor } from "./imageEditor.ts";
import { renderPdf } from "./pdfExport.ts";

const LOCKED_COPY =
  "That is part of Stepsmith Pro, a one-time unlock: PDF export, redact and annotate screenshots, " +
  "automatic blurring of emails and long numbers, your own branding, and Markdown with image files. " +
  "Everything free today stays free.";

export async function renderEditor(view: HTMLElement, id: string): Promise<void> {
  let guide = await getGuide(id);
  if (guide === undefined) {
    view.replaceChildren(
      h("h1", {}, "Guide not found"),
      h("p", {}, h("a", { href: "#/" }, "Back to your guides")),
    );
    return;
  }
  const images = new Map<string, Blob>();
  for (const step of guide.steps) {
    if (step.imageId === null) continue;
    const stored = await getImage(step.imageId);
    if (stored !== undefined) images.set(step.imageId, stored.blob);
  }
  const recording = (await chrome.runtime.sendMessage({
    type: "getRecording",
  })) as GetRecordingResponse;
  const isRecording = recording.recording?.guideId === id;
  const urls: string[] = [];
  const note = h("div", { class: "note", id: "pro-locked", hidden: true }, LOCKED_COPY, " ",
    h("a", { href: "#/settings" }, "See what Pro includes"));
  const status = h("span", { class: "status", id: "editor-status" });

  const persist = async (next: Guide): Promise<void> => {
    guide = next;
    await saveGuide(next);
  };
  const lockedOr = async (feature: Parameters<typeof hasFeature>[0], action: () => Promise<void>) => {
    if (!(await hasFeature(feature))) {
      note.hidden = false;
      note.scrollIntoView({ block: "nearest" });
      return;
    }
    status.textContent = "Working…";
    try {
      await action();
      status.textContent = "Done.";
    } catch (error) {
      status.textContent = `Failed: ${error instanceof Error ? error.message : String(error)}`;
    }
  };

  const render = (): void => {
    for (const url of urls.splice(0)) URL.revokeObjectURL(url);
    const current = guide as Guide;
    const title = h("input", {
      class: "title-input",
      id: "guide-title",
      value: current.title,
      "aria-label": "Guide title",
      onChange: (e: Event) => void persist(setTitle(guide as Guide, (e.target as HTMLInputElement).value)),
    });

    const exportRow = h("div", { class: "row" },
      h("button", { id: "btn-copy-md", onClick: () => void copyMarkdown() }, "Copy as Markdown"),
      h("button", { id: "btn-export-html", onClick: () => void exportHtml() }, "Export HTML"),
      h("button", { id: "btn-export-pdf", onClick: () => void lockedOr("pdfExport", exportPdf) },
        "Export PDF ", h("span", { class: "pro-badge" }, "PRO")),
      h("button", { id: "btn-export-zip", onClick: () => void lockedOr("markdownZip", exportZip) },
        "Markdown + images (.zip) ", h("span", { class: "pro-badge" }, "PRO")),
      h("span", { class: "spacer" }),
      h("button", { id: "btn-add-text", onClick: () => void addText() }, "Add a text step"),
    );

    const list = h("div", { id: "steps" },
      ...current.steps.map((step, i) => stepCard(step, i, current.steps.length)));
    if (current.steps.length === 0) {
      list.append(h("div", { class: "card" }, "No steps yet. Add a text step, or record a tab from the Stepsmith toolbar button."));
    }

    view.replaceChildren(
      h("p", {}, h("a", { href: "#/", class: "back-link" }, "← All guides")),
      ...(isRecording
        ? [h("div", { class: "note warn", id: "recording-note" },
            "This guide is being recorded right now. New steps appear here as you click in the recorded tab.")]
        : []),
      title,
      h("p", { class: "lede" }, `${current.steps.length} step${current.steps.length === 1 ? "" : "s"} · saved on this device · wrap words in **double asterisks** for bold`),
      exportRow, h("div", { class: "row" }, status), note, list,
    );
  };

  function stepCard(step: Step, index: number, count: number): HTMLElement {
    const blob = step.imageId === null ? undefined : images.get(step.imageId);
    const caption = h("input", {
      class: "caption-input",
      value: step.caption,
      "aria-label": `Caption for step ${index + 1}`,
      onChange: (e: Event) => void persist(setCaption(guide as Guide, step.id, (e.target as HTMLInputElement).value)),
    });
    const body = h("div", {}, caption);
    let editorOpen = false;
    const editHost = h("div", {});
    if (blob !== undefined && step.imageId !== null) {
      const url = URL.createObjectURL(blob);
      urls.push(url);
      const img = h("img", { src: url, alt: `Screenshot for step ${index + 1}` });
      const shot = h("div", { class: "shot" }, img);
      const imageId = step.imageId;
      body.append(editHost, shot);
      const toggle = h("button", {
        class: "small edit-image",
        onClick: () => void lockedOr("redaction", async () => {
          editorOpen = !editorOpen;
          if (!editorOpen) {
            editHost.replaceChildren();
            shot.querySelector(".overlay")?.remove();
            return;
          }
          const tools = createImageEditor({
            img,
            current: () => images.get(imageId) as Blob,
            commit: async (next) => {
              const size = await decodeSize(next);
              await saveImage({ id: imageId, blob: next, ...size });
              images.set(imageId, next);
              const fresh = URL.createObjectURL(next);
              urls.push(fresh);
              img.src = fresh;
            },
          });
          editHost.replaceChildren(tools.toolbar);
          shot.append(tools.overlay);
        }),
      }, "Edit image ", h("span", { class: "pro-badge" }, "PRO"));
      body.insertBefore(h("div", { class: "toolbar" }, toggle), editHost);
    }
    if (step.kind !== "text" && blob === undefined) {
      body.append(h("p", { class: "lede no-shot" },
        "No screenshot was captured for this step (the page changed too quickly)."));
    }
    const controls = h("div", { class: "toolbar" },
      h("button", { class: "small move-up", disabled: index === 0, "aria-label": "Move step up",
        onClick: () => void change(moveStep(guide as Guide, step.id, -1)) }, "▲"),
      h("button", { class: "small move-down", disabled: index === count - 1, "aria-label": "Move step down",
        onClick: () => void change(moveStep(guide as Guide, step.id, 1)) }, "▼"),
      h("button", { class: "small danger delete-step", onClick: () => void remove(step) }, "Delete step"),
    );
    body.append(controls);
    return h("div", { class: "card step" }, h("div", { class: "num" }, String(index + 1)), body);
  }

  async function change(next: Guide): Promise<void> {
    await persist(next);
    render();
  }

  async function remove(step: Step): Promise<void> {
    await change(deleteStep(guide as Guide, step.id));
    if (step.imageId !== null) {
      images.delete(step.imageId);
      await deleteImages([step.imageId]);
    }
  }

  async function addText(): Promise<void> {
    await change(addStep(guide as Guide, makeStep("text", "Describe this step", null)));
    const inputs = view.querySelectorAll<HTMLInputElement>(".caption-input");
    const last = inputs[inputs.length - 1];
    last?.focus();
    last?.select();
  }

  async function copyMarkdown(): Promise<void> {
    await navigator.clipboard.writeText(renderMarkdown(guide as Guide));
    status.textContent = "Copied. Screenshots are not included in copied Markdown; use the HTML export for those.";
  }

  async function exportHtml(): Promise<void> {
    const dataUrls: Record<string, string> = {};
    for (const [imageId, blob] of images) dataUrls[imageId] = await blobToDataUrl(blob);
    const html = renderHtml(guide as Guide, dataUrls, await brandingForExport());
    downloadBlob(new Blob([html], { type: "text/html" }), `${fileStem((guide as Guide).title)}.html`);
    status.textContent = "HTML saved.";
  }

  async function exportPdf(): Promise<void> {
    const pdf = await renderPdf(guide as Guide, images, await brandingForExport());
    downloadBlob(new Blob([pdf as BlobPart], { type: "application/pdf" }), `${fileStem((guide as Guide).title)}.pdf`);
  }

  async function exportZip(): Promise<void> {
    const current = guide as Guide;
    const files: { name: string; data: Uint8Array }[] = [];
    const paths: Record<string, string> = {};
    for (const [i, step] of current.steps.entries()) {
      const blob = step.imageId === null ? undefined : images.get(step.imageId);
      if (blob === undefined || step.imageId === null) continue;
      const path = `images/step-${String(i + 1).padStart(2, "0")}.jpg`;
      paths[step.imageId] = path;
      files.push({ name: path, data: new Uint8Array(await blob.arrayBuffer()) });
    }
    files.unshift({
      name: "guide.md",
      data: new TextEncoder().encode(renderMarkdown(current, paths)),
    });
    downloadBlob(new Blob([buildZip(files) as BlobPart], { type: "application/zip" }), `${fileStem(current.title)}.zip`);
  }

  render();
}
