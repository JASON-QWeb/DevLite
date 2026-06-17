export async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.cssText = "position:fixed;left:-9999px;top:-9999px;";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
  }
}
