import { formatBytes } from "./utils";

const MAX_IMAGE_FILE_BYTES = 5 * 1024 * 1024;

export type ImageFilePayload = {
  src: string;
  label: string;
  name: string;
  type: string;
  size: number;
  isSvg: boolean;
};

type ImageFileInputOptions = {
  input: HTMLInputElement | null;
  onError: () => void;
  onLoad: (payload: ImageFilePayload) => void;
};

export function bindImageFileInput(options: ImageFileInputOptions): void {
  const { input } = options;
  if (!input) return;
  input.addEventListener("change", () => {
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    if (file.size > MAX_IMAGE_FILE_BYTES) {
      options.onError();
      return;
    }
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      const dataUrl = typeof reader.result === "string" ? reader.result : "";
      if (!dataUrl) {
        options.onError();
        return;
      }
      const type = file.type || inferImageType(file.name);
      options.onLoad({
        src: dataUrl,
        label: `${file.name} / ${type || "image"} / ${formatBytes(file.size)}`,
        name: file.name,
        type,
        size: file.size,
        isSvg: type === "image/svg+xml" || /\.svg$/i.test(file.name)
      });
    });
    reader.addEventListener("error", options.onError);
    reader.readAsDataURL(file);
  });
}

function inferImageType(name: string): string {
  if (/\.svg$/i.test(name)) return "image/svg+xml";
  if (/\.png$/i.test(name)) return "image/png";
  if (/\.jpe?g$/i.test(name)) return "image/jpeg";
  if (/\.webp$/i.test(name)) return "image/webp";
  if (/\.gif$/i.test(name)) return "image/gif";
  return "";
}
