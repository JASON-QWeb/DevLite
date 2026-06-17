import { formatBytes } from "./utils";

const MAX_IMAGE_FILE_BYTES = 5 * 1024 * 1024;

type ImageFileInputOptions = {
  input: HTMLInputElement | null;
  onError: () => void;
  onLoad: (src: string, label: string) => void;
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
      options.onLoad(dataUrl, `${file.name} / ${file.type || "image"} / ${formatBytes(file.size)}`);
    });
    reader.addEventListener("error", options.onError);
    reader.readAsDataURL(file);
  });
}
