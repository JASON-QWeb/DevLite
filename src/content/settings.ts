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
    maxResponseLength: input?.maxResponseLength ?? DEFAULT_PANEL_SETTINGS.maxResponseLength,
    slowRequestThreshold: input?.slowRequestThreshold ?? DEFAULT_PANEL_SETTINGS.slowRequestThreshold,
    retainHours: input?.retainHours ?? DEFAULT_PANEL_SETTINGS.retainHours,
    extraRedactionKeys: input?.extraRedactionKeys ?? DEFAULT_PANEL_SETTINGS.extraRedactionKeys
  };
}

export function collectPanelSettingsForm(panel: ParentNode | null, current: Required<PanelSettings>): PanelSettings {
  const locale = normalizeLocale(panel?.querySelector<HTMLSelectElement>('[data-setting="locale"]')?.value ?? current.locale);
  const uiTheme = normalizeTheme(panel?.querySelector<HTMLInputElement>('input[name="uiTheme"]:checked')?.value ?? current.uiTheme);
  const collectResponseBody = panel?.querySelector<HTMLInputElement>('[data-setting="collectResponseBody"]')?.checked ?? false;
  const maxResponseLength = Number(panel?.querySelector<HTMLInputElement>('[data-setting="maxResponseLength"]')?.value || current.maxResponseLength);
  const slowRequestThreshold = Number(panel?.querySelector<HTMLInputElement>('[data-setting="slowRequestThreshold"]')?.value || current.slowRequestThreshold);
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
