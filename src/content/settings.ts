import { normalizeContentLocale } from "./i18n";
import { DEFAULT_PANEL_SETTINGS } from "./panelConfig";
import type { PanelSettings, UiLocale, UiTheme } from "./types";

export function normalizeLocale(value: unknown): UiLocale {
  return normalizeContentLocale(value);
}

export function normalizeTheme(value: unknown): UiTheme {
  return value === "saas" || value === "dark" || value === "cartoon" ? value : "claude";
}

export function mergePanelSettings(input?: PanelSettings): Required<PanelSettings> {
  return {
    locale: normalizeLocale(input?.locale ?? DEFAULT_PANEL_SETTINGS.locale),
    uiTheme: normalizeTheme(input?.uiTheme ?? DEFAULT_PANEL_SETTINGS.uiTheme),
    collectResponseBody: input?.collectResponseBody ?? DEFAULT_PANEL_SETTINGS.collectResponseBody,
    maxResponseLength: clampNumber(input?.maxResponseLength, 256, 10000, DEFAULT_PANEL_SETTINGS.maxResponseLength),
    slowRequestThreshold: clampNumber(input?.slowRequestThreshold, 300, 20000, DEFAULT_PANEL_SETTINGS.slowRequestThreshold),
    retainHours: clampNumber(input?.retainHours, 1, 24 * 30, DEFAULT_PANEL_SETTINGS.retainHours),
    extraRedactionKeys: input?.extraRedactionKeys ?? DEFAULT_PANEL_SETTINGS.extraRedactionKeys
  };
}

export function collectPanelSettingsForm(panel: ParentNode | null, current: Required<PanelSettings>): PanelSettings {
  const locale = normalizeLocale(panel?.querySelector<HTMLSelectElement>('[data-setting="locale"]')?.value ?? current.locale);
  const uiTheme = normalizeTheme(panel?.querySelector<HTMLInputElement>('input[name="uiTheme"]:checked')?.value ?? current.uiTheme);
  const collectResponseBody = panel?.querySelector<HTMLInputElement>('[data-setting="collectResponseBody"]')?.checked ?? current.collectResponseBody;
  const maxResponseLength = clampNumber(panel?.querySelector<HTMLInputElement>('[data-setting="maxResponseLength"]')?.value, 256, 10000, current.maxResponseLength);
  const slowRequestThreshold = clampNumber(panel?.querySelector<HTMLInputElement>('[data-setting="slowRequestThreshold"]')?.value, 300, 20000, current.slowRequestThreshold);
  const extraRedactionKeys = (panel?.querySelector<HTMLTextAreaElement>('[data-setting="extraRedactionKeys"]')?.value ?? "")
    .split(/\n+/)
    .map((item) => item.trim())
    .filter(Boolean);

  return {
    ...current,
    locale,
    uiTheme,
    collectResponseBody,
    maxResponseLength,
    slowRequestThreshold,
    extraRedactionKeys
  };
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}
