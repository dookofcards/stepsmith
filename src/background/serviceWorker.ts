// The service worker can be killed at any time, so no state may survive in
// module scope between events: every handler re-reads from storage.
//
// The ExtPay import below must stay at top level: MV3 only allows
// importScripts() during the worker's initial evaluation, and a later call
// fails with ERR_FAILED. Loading it is inert — nothing runs and no request
// is made until the user actually clicks Upgrade.
import { paymentConfigured } from "../shared/constants.ts";

declare function importScripts(...urls: string[]): void;

if (paymentConfigured()) {
  try {
    importScripts("extpay/ExtPay.js");
  } catch {
    // Payment simply stays unavailable; recording must not be affected.
  }
}

import { clearEverything } from "../core/db.ts";
import {
  beginUpgrade,
  registerPaymentListeners,
  revalidateEntitlement,
} from "./payment.ts";
import {
  getRecording,
  handleRecorderSteps,
  onTabRemoved,
  onTabUpdated,
  startRecording,
  stopRecording,
} from "./recording.ts";
import type { BeginUpgradeResponse, Message } from "../shared/messages.ts";

registerPaymentListeners();

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  void onTabUpdated(tabId, changeInfo);
});
chrome.tabs.onRemoved.addListener((tabId) => {
  void onTabRemoved(tabId);
});
chrome.runtime.onStartup.addListener(() => {
  void revalidateEntitlement();
});
chrome.runtime.onInstalled.addListener(() => {
  void revalidateEntitlement();
});

chrome.runtime.onMessage.addListener(
  (message: Message, sender, sendResponse: (response: unknown) => void) => {
    switch (message.type) {
      case "startRecording":
        void startRecording(message.tabId, message.windowId).then(sendResponse);
        return true;
      case "stopRecording":
        void stopRecording().then(async (result) => {
          if (message.openEditor && result.guideId !== null) {
            await chrome.tabs.create({
              url: chrome.runtime.getURL(`app/app.html#/guide/${result.guideId}`),
            });
          }
          sendResponse(result);
        });
        return true;
      case "getRecording":
        void getRecording().then((recording) => sendResponse({ recording }));
        return true;
      case "recorderSteps":
        void handleRecorderSteps(message, sender.tab?.id).then(sendResponse);
        return true;
      case "beginUpgrade":
        void beginUpgrade().then((started) => {
          const response: BeginUpgradeResponse = { started };
          sendResponse(response);
        });
        return true;
      case "deleteAllData":
        void clearEverything().then(() => sendResponse({ ok: true }));
        return true;
    }
    return false;
  },
);
