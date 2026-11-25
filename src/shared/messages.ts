// Typed messages between pages, the recorder content script and the service
// worker.
import type { Rect, Viewport } from "../core/geometry.ts";

export interface RecordingState {
  guideId: string;
  tabId: number;
  windowId: number;
  steps: number;
  startedAt: number;
}

export interface StartRecordingMessage {
  type: "startRecording";
  tabId: number;
  windowId: number;
}

export type StartRecordingError =
  | "needsPermission"
  | "unsupportedPage"
  | "busy"
  | "failed";

export type StartRecordingResponse =
  | { ok: true; guideId: string }
  | { ok: false; error: StartRecordingError };

export interface StopRecordingMessage {
  type: "stopRecording";
  /** Open the editor on the finished guide. */
  openEditor: boolean;
}

export interface StopRecordingResponse {
  guideId: string | null;
  steps: number;
}

export interface GetRecordingMessage {
  type: "getRecording";
}

export interface GetRecordingResponse {
  recording: RecordingState | null;
}

/** Sent by the page recorder: one capture, one or two steps. */
export interface RecorderStep {
  kind: "click" | "type";
  /** Visible label only. Never a typed value. */
  label: string;
  highlight: Rect;
}

export interface RecorderStepsMessage {
  type: "recorderSteps";
  steps: RecorderStep[];
  /** Always blurred: password, one-time-code and card fields. */
  blurs: Rect[];
  /** Blurred only with Pro: emails and long numbers in text fields. */
  piiBlurs: Rect[];
  viewport: Viewport;
}

export interface RecorderStepsResponse {
  ok: boolean;
  /** True when this tab is not being recorded; the script detaches. */
  stop?: boolean;
}

export interface CollectBlursMessage {
  type: "collectBlurs";
}

export interface CollectBlursResponse {
  blurs: Rect[];
  piiBlurs: Rect[];
  viewport: Viewport;
}

export interface StopRecorderMessage {
  type: "stopRecorder";
}

/** Opens the ExtensionPay checkout. The only message that touches a network. */
export interface BeginUpgradeMessage {
  type: "beginUpgrade";
}

export interface BeginUpgradeResponse {
  /** False when payment is not configured for this build. */
  started: boolean;
}

export interface DeleteAllDataMessage {
  type: "deleteAllData";
}

export type Message =
  | StartRecordingMessage
  | StopRecordingMessage
  | GetRecordingMessage
  | RecorderStepsMessage
  | BeginUpgradeMessage
  | DeleteAllDataMessage;
