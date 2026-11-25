// The build script injects these into manifest.json, so a rename happens
// here and nowhere else.
export const EXTENSION_NAME = "Stepsmith: Step-by-Step Guide Maker";
export const EXTENSION_DESCRIPTION =
  "Record the steps you take on a website and turn them into a step-by-step guide with screenshots, kept on your device.";

/** Outbound links shown in the UI. Nothing here is fetched at runtime. */
export const HOMEPAGE_URL = "https://dookofcards.github.io/stepsmith/";
export const SUPPORT_URL = "https://github.com/dookofcards/stepsmith/issues";

/**
 * ExtensionPay slug, obtained by registering the extension at
 * extensionpay.com and connecting a Stripe account. While it is empty,
 * payment is not configured: no upgrade UI is shown, no payment code loads,
 * and the extension makes no network requests at all.
 */
// Typed as string, not inferred as a literal: paymentConfigured() compares it
// against "", which TypeScript rejects as impossible once a real slug narrows
// the type.
export const EXTENSIONPAY_ID: string = "stepsmith";

export const paymentConfigured = (): boolean => EXTENSIONPAY_ID !== "";

/** Chrome allows about two captureVisibleTab calls per second. */
export const MIN_CAPTURE_GAP_MS = 600;
/** JPEG quality used for every stored screenshot. */
export const IMAGE_QUALITY = 0.85;
/** Origins we ask for, once, when the user starts their first recording. */
export const RECORDING_ORIGINS = ["<all_urls>"];
