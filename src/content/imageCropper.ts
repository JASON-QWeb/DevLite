import type { ContentTextKey } from "./i18n";
import type { ImageFilePayload } from "./imageFileInput";
import type { ImageEditMetadata } from "./types";
import { randomId } from "./utils";

export type ImageCropResult = {
  src: string;
  label: string;
  metadata: ImageEditMetadata;
};

type ImageCropperOptions = {
  t: (key: ContentTextKey) => string;
  sendRequest: (message: Record<string, unknown>) => void;
  onApply: (result: ImageCropResult) => void;
  onCancel: () => void;
  onError: () => void;
};

export class ImageCropperController {
  private activeCropperId: string | null = null;

  constructor(private readonly options: ImageCropperOptions) {}

  start(payload: ImageFilePayload, targetElement: HTMLElement): void {
    this.close(false);
    const cropperId = randomId();
    this.activeCropperId = cropperId;
    this.options.sendRequest({
      type: "image-cropper-open",
      cropperId,
      payload: {
        src: payload.src,
        label: payload.label,
        name: payload.name,
        type: payload.type,
        size: payload.size
      },
      targetAspectRatio: elementAspectRatio(targetElement),
      texts: cropperTexts(this.options.t)
    });
  }

  close(cancel = true): void {
    const cropperId = this.activeCropperId;
    if (!cropperId) return;
    this.activeCropperId = null;
    this.options.sendRequest({ type: "image-cropper-close", cropperId });
    if (cancel) this.options.onCancel();
  }

  handlePageMessage(data: unknown): boolean {
    if (!data || typeof data !== "object") return false;
    const message = data as { type?: string; cropperId?: string; result?: ImageCropResult };
    if (!message.type?.startsWith("image-cropper-") || message.cropperId !== this.activeCropperId) {
      return false;
    }

    this.activeCropperId = null;
    if (message.type === "image-cropper-result" && message.result?.src && message.result.metadata) {
      this.options.onApply(message.result);
      return true;
    }
    if (message.type === "image-cropper-cancel") {
      this.options.onCancel();
      return true;
    }

    this.options.onError();
    return true;
  }
}

function cropperTexts(t: (key: ContentTextKey) => string): Record<string, string> {
  return {
    cropImage: t("cropImage"),
    cancel: t("cancel"),
    matchElementRatio: t("matchElementRatio"),
    freeRatio: t("freeRatio"),
    zoomOut: t("zoomOut"),
    zoomIn: t("zoomIn"),
    resetCrop: t("resetCrop"),
    applyCrop: t("applyCrop")
  };
}

function elementAspectRatio(element: HTMLElement): number | null {
  const rect = element.getBoundingClientRect();
  if (rect.width > 0 && rect.height > 0) return rect.width / rect.height;
  const width = element.offsetWidth;
  const height = element.offsetHeight;
  return width > 0 && height > 0 ? width / height : null;
}
