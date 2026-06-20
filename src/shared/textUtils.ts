export function truncateInlineImages(value: string, max: number): string {
  return truncate(value.replace(/data:image\/[a-z0-9.+-]+(?:;[a-z0-9=+-]+)*;base64,[a-z0-9+/=]+/gi, "[inline image data]"), max);
}

export function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max)}\n...[TRUNCATED ${value.length - max} chars]`;
}
