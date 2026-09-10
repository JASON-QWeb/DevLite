import type { ElementDocumentContext, ImageEditMetadata, StyleChange } from "./types";

export type ElementSnapshot = {
  change: StyleChange;
  computed: Record<string, string>;
  canEditText: boolean;
  canReplaceImage: boolean;
  canReplaceIcon: boolean;
  width: number;
  height: number;
};

export type ElementCommand =
  | { action: "style"; property: string; value: string }
  | { action: "image"; src: string; label: string; metadata?: ImageEditMetadata }
  | { action: "icon"; value: string; label: string }
  | { action: "requirement"; text: string }
  | { action: "text"; value: string }
  | { action: "parent" | "text-start" | "text-stop" | "delete" | "undo" | "mark" | "verify" | "forget" };

export type ElementCommandRequest = {
  type: "devlite-element-command";
  requestId: string;
  documentId: string;
  change: StyleChange;
  command: ElementCommand;
};

export type FrameInfo = ElementDocumentContext & { nonce: string; pathReady: boolean };
