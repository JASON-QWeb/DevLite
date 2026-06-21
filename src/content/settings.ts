import { normalizeContentLocale } from "./i18n";
import { DEFAULT_PANEL_SETTINGS } from "./panelConfig";
import type { PanelSettings, UiLocale, UiTheme } from "./types";

export function normalizeLocale(value: unknown): UiLocale {
  return normalizeContentLocale(value);
}

export function normalizeTheme(value: unknown): UiTheme {
  return value === "system" || value === "saas" || value === "dark" ? value : "claude";
}

export function mergePanelSettings(input?: PanelSettings): Required<PanelSettings> {
  return {
    locale: normalizeLocale(input?.locale ?? DEFAULT_PANEL_SETTINGS.locale),
    uiTheme: normalizeTheme(input?.uiTheme ?? DEFAULT_PANEL_SETTINGS.uiTheme),
    collectResponseBody: input?.collectResponseBody ?? DEFAULT_PANEL_SETTINGS.collectResponseBody,
    maxResponseLength: clampNumber(input?.maxResponseLength, 256, 10000, DEFAULT_PANEL_SETTINGS.maxResponseLength),
    slowRequestThreshold: clampNumber(input?.slowRequestThreshold, 300, 20000, DEFAULT_PANEL_SETTINGS.slowRequestThreshold),
    performanceTtfbWarning: clampNumber(input?.performanceTtfbWarning, 100, 10000, DEFAULT_PANEL_SETTINGS.performanceTtfbWarning),
    performanceTtfbError: clampNumber(input?.performanceTtfbError, 100, 20000, DEFAULT_PANEL_SETTINGS.performanceTtfbError),
    performanceDomReadyWarning: clampNumber(input?.performanceDomReadyWarning, 500, 30000, DEFAULT_PANEL_SETTINGS.performanceDomReadyWarning),
    performanceLoadWarning: clampNumber(input?.performanceLoadWarning, 500, 60000, DEFAULT_PANEL_SETTINGS.performanceLoadWarning),
    performanceLoadError: clampNumber(input?.performanceLoadError, 500, 120000, DEFAULT_PANEL_SETTINGS.performanceLoadError),
    performanceResourceSizeWarning: clampNumber(input?.performanceResourceSizeWarning, 64 * 1024, 20 * 1024 * 1024, DEFAULT_PANEL_SETTINGS.performanceResourceSizeWarning),
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
  const performanceTtfbWarning = clampNumber(panel?.querySelector<HTMLInputElement>('[data-setting="performanceTtfbWarning"]')?.value, 100, 10000, current.performanceTtfbWarning);
  const performanceTtfbError = clampNumber(panel?.querySelector<HTMLInputElement>('[data-setting="performanceTtfbError"]')?.value, 100, 20000, current.performanceTtfbError);
  const performanceDomReadyWarning = clampNumber(panel?.querySelector<HTMLInputElement>('[data-setting="performanceDomReadyWarning"]')?.value, 500, 30000, current.performanceDomReadyWarning);
  const performanceLoadWarning = clampNumber(panel?.querySelector<HTMLInputElement>('[data-setting="performanceLoadWarning"]')?.value, 500, 60000, current.performanceLoadWarning);
  const performanceLoadError = clampNumber(panel?.querySelector<HTMLInputElement>('[data-setting="performanceLoadError"]')?.value, 500, 120000, current.performanceLoadError);
  const performanceResourceSizeWarning = clampNumber(panel?.querySelector<HTMLInputElement>('[data-setting="performanceResourceSizeWarning"]')?.value, 64 * 1024, 20 * 1024 * 1024, current.performanceResourceSizeWarning);
  const extraRedactionInput = panel?.querySelector<HTMLTextAreaElement>('[data-setting="extraRedactionKeys"]');
  const extraRedactionKeys = extraRedactionInput
    ? extraRedactionInput.value
        .split(/\n+/)
        .map((item) => item.trim())
        .filter(Boolean)
    : current.extraRedactionKeys;

  return {
    ...current,
    locale,
    uiTheme,
    collectResponseBody,
    maxResponseLength,
    slowRequestThreshold,
    performanceTtfbWarning,
    performanceTtfbError,
    performanceDomReadyWarning,
    performanceLoadWarning,
    performanceLoadError,
    performanceResourceSizeWarning,
    extraRedactionKeys
  };
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}
