// Paid-tier capability checks.
//
// A single one-time unlock turns on every pro feature, so the per-feature
// enum exists for call-site readability rather than for separate products.
//
// The entitlement is cached in storage.local — device-local on purpose, since
// it is re-validated per device rather than synced. Nothing here touches the
// network; payment lives behind an explicit user action (see payment.ts).
export type ProFeature =
  | "pdfExport"
  | "redaction"
  | "annotate"
  | "branding"
  | "markdownZip"
  | "autoBlur";

const ENTITLEMENT_KEY = "proEntitlement";

export interface Entitlement {
  active: boolean;
  /** Epoch ms of the last successful check; 0 means never checked. */
  checkedAt: number;
}

const NO_ENTITLEMENT: Entitlement = { active: false, checkedAt: 0 };

export async function getEntitlement(): Promise<Entitlement> {
  try {
    const stored = await chrome.storage.local.get(ENTITLEMENT_KEY);
    const saved = stored[ENTITLEMENT_KEY] as Partial<Entitlement> | undefined;
    if (saved === undefined) return NO_ENTITLEMENT;
    return {
      active: saved.active === true,
      checkedAt: typeof saved.checkedAt === "number" ? saved.checkedAt : 0,
    };
  } catch {
    // Storage unavailable: fall back to the free tier rather than granting
    // access on an error path.
    return NO_ENTITLEMENT;
  }
}

export async function setEntitlement(active: boolean): Promise<void> {
  const entitlement: Entitlement = { active, checkedAt: Date.now() };
  await chrome.storage.local.set({ [ENTITLEMENT_KEY]: entitlement });
}

/**
 * Async because the answer lives in storage and the service worker's module
 * scope is wiped on every restart — a cached boolean would be wrong exactly
 * when a capture runs after a wake-up.
 */
export async function hasFeature(_feature: ProFeature): Promise<boolean> {
  return (await getEntitlement()).active;
}
