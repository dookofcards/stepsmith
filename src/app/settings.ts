import { getEntitlement } from "../shared/features.ts";
import { paymentConfigured } from "../shared/constants.ts";
import type { BeginUpgradeResponse } from "../shared/messages.ts";
import { getStoredBranding, logoFromFile, saveBranding } from "./branding.ts";
import { h } from "./dom.ts";

export async function renderSettings(view: HTMLElement): Promise<void> {
  const pro = (await getEntitlement()).active;
  const branding = await getStoredBranding();
  const status = h("span", { class: "status", id: "settings-status" });

  const accent = h("input", { type: "color", id: "brand-accent", value: branding.accent, disabled: !pro });
  const footer = h("input", { type: "text", id: "brand-footer", value: branding.footer, maxLength: 200, disabled: !pro,
    placeholder: "e.g. Acme Support · support@acme.example" });
  const logoInput = h("input", { type: "file", id: "brand-logo", accept: "image/png,image/jpeg,image/webp,image/gif", disabled: !pro });
  const logoPreview = h("img", { alt: "", height: 40 });
  logoPreview.style.display = branding.logoDataUrl === "" ? "none" : "block";
  if (branding.logoDataUrl !== "") logoPreview.src = branding.logoDataUrl;
  let logoDataUrl = branding.logoDataUrl;

  const save = async (): Promise<void> => {
    await saveBranding({ accent: accent.value, footer: footer.value, logoDataUrl });
    status.textContent = "Saved.";
  };
  accent.addEventListener("change", () => void save());
  footer.addEventListener("change", () => void save());
  logoInput.addEventListener("change", () => {
    const file = logoInput.files?.[0];
    if (file === undefined) return;
    void logoFromFile(file).then(async (url) => {
      logoDataUrl = url;
      logoPreview.src = url;
      logoPreview.style.display = "block";
      await save();
    });
  });

  const upgrade = h("button", { class: "primary", id: "btn-upgrade", hidden: pro || !paymentConfigured(),
    onClick: async () => {
      const response = (await chrome.runtime.sendMessage({ type: "beginUpgrade" })) as BeginUpgradeResponse;
      status.textContent = response.started ? "Checkout opened in a new tab." : "Upgrade is not available yet.";
    } }, "Unlock Pro (one-time)");

  const wipe = h("button", { class: "danger", id: "btn-delete-all" }, "Delete all my guides and screenshots");
  let armed = false;
  wipe.addEventListener("click", async () => {
    if (!armed) {
      armed = true;
      wipe.textContent = "Click again to delete everything";
      return;
    }
    await chrome.runtime.sendMessage({ type: "deleteAllData" });
    armed = false;
    wipe.textContent = "Deleted.";
  });

  view.replaceChildren(
    h("h1", {}, "Settings"),
    h("p", { class: "lede" }, "The free version makes no network requests. Your guides and screenshots never leave your device."),
    h("div", { class: "card", id: "pro-panel" },
      h("h2", {}, "Stepsmith Pro ", pro ? h("span", { class: "pro-badge", id: "pro-active" }, "UNLOCKED") : null),
      pro
        ? h("p", {}, "Thank you. Pro features are unlocked on this device.")
        : h("div", {},
            h("p", { id: "pro-note" }, "Recording, editing, HTML export and Markdown copy are free. Pro is a one-time unlock for:"),
            h("ul", { class: "pro-list" },
              h("li", {}, "PDF export"),
              h("li", {}, "Redact and annotate screenshots (blur, black out, boxes, arrows, text, crop)"),
              h("li", {}, "Automatic blurring of email addresses and long numbers"),
              h("li", {}, "Your logo, colour and footer on exports"),
              h("li", {}, "Markdown export as a .zip with image files")),
            paymentConfigured()
              ? h("p", { class: "lede" }, "Buying Pro opens ExtensionPay's checkout in a new tab. That is the only time Stepsmith contacts a server.")
              : h("p", { class: "lede" }, "Pro is coming soon.")),
      upgrade),
    h("div", { class: "card", id: "branding-panel" },
      h("h2", {}, "Branding ", h("span", { class: "pro-badge" }, "PRO")),
      pro ? null : h("p", { class: "lede" }, "Add your logo, accent colour and footer to HTML and PDF exports with Pro."),
      h("label", { class: "field" }, h("span", {}, "Accent colour"), accent),
      h("label", { class: "field" }, h("span", {}, "Footer text"), footer),
      h("label", { class: "field" }, h("span", {}, "Logo"), logoInput, logoPreview)),
    h("div", { class: "card" },
      h("h2", {}, "Your data"),
      h("p", {}, "Guides and screenshots are stored in this browser's local database. Nothing is synced or uploaded."),
      wipe),
    status,
  );
}
