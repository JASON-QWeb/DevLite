import { truncate } from "./utils";

export function getPageContext(): Record<string, unknown> {
  return {
    url: location.href,
    title: document.title,
    userAgent: navigator.userAgent,
    language: navigator.language,
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio
    },
    startedAt: Date.now()
  };
}

export function formatUrl(value: string): string {
  if (!value) return "unknown";
  try {
    const url = new URL(value, location.href);
    return truncate(`${url.pathname}${url.search}`, 96);
  } catch {
    return truncate(value, 96);
  }
}
