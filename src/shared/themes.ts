import type { UiTheme } from "./types";

export type UiThemeToken =
  | "bg"
  | "surface"
  | "surface2"
  | "sidebar"
  | "border"
  | "borderStrong"
  | "text"
  | "textMuted"
  | "primary"
  | "primaryHover"
  | "primarySoft"
  | "onPrimary"
  | "danger"
  | "warning"
  | "success"
  | "codeText"
  | "toastBg"
  | "shadow"
  | "focus";

export type UiThemeDefinition = {
  id: UiTheme;
  tokens: Record<UiThemeToken, string>;
};

export const UI_THEMES: Record<UiTheme, UiThemeDefinition> = {
  system: {
    id: "system",
    tokens: {
      bg: "#FAF9F5",
      surface: "#FFFFFF",
      surface2: "#F4F3EE",
      sidebar: "#F1EFE7",
      border: "#E8E6DC",
      borderStrong: "#D4D0C4",
      text: "#141413",
      textMuted: "#6F6A60",
      primary: "#D97757",
      primaryHover: "#C15F3C",
      primarySoft: "#F3DED4",
      onPrimary: "#FFFFFF",
      danger: "#B94A48",
      warning: "#B8792F",
      success: "#788C5D",
      codeText: "#7B402F",
      toastBg: "#141413",
      shadow: "rgba(32, 28, 22, 0.18)",
      focus: "rgba(217, 119, 87, 0.32)"
    }
  },
  claude: {
    id: "claude",
    tokens: {
      bg: "#FAF9F5",
      surface: "#FFFFFF",
      surface2: "#F4F3EE",
      sidebar: "#F1EFE7",
      border: "#E8E6DC",
      borderStrong: "#D4D0C4",
      text: "#141413",
      textMuted: "#6F6A60",
      primary: "#D97757",
      primaryHover: "#C15F3C",
      primarySoft: "#F3DED4",
      onPrimary: "#FFFFFF",
      danger: "#B94A48",
      warning: "#B8792F",
      success: "#788C5D",
      codeText: "#7B402F",
      toastBg: "#141413",
      shadow: "rgba(32, 28, 22, 0.18)",
      focus: "rgba(217, 119, 87, 0.32)"
    }
  },
  saas: {
    id: "saas",
    tokens: {
      bg: "#F6F8FB",
      surface: "#FFFFFF",
      surface2: "#F0F3F8",
      sidebar: "#EEF2F7",
      border: "#DCE3EC",
      borderStrong: "#C6D0DE",
      text: "#111827",
      textMuted: "#64748B",
      primary: "#315CFF",
      primaryHover: "#2447C8",
      primarySoft: "#E7EDFF",
      onPrimary: "#FFFFFF",
      danger: "#DC2626",
      warning: "#D97706",
      success: "#14B8A6",
      codeText: "#2546B8",
      toastBg: "#111827",
      shadow: "rgba(17, 24, 39, 0.18)",
      focus: "rgba(49, 92, 255, 0.3)"
    }
  },
  dark: {
    id: "dark",
    tokens: {
      bg: "#0E1116",
      surface: "#151A22",
      surface2: "#1B222C",
      sidebar: "#111720",
      border: "#293241",
      borderStrong: "#3A4556",
      text: "#E8EBF0",
      textMuted: "#9AA4B2",
      primary: "#7AA2FF",
      primaryHover: "#A8C1FF",
      primarySoft: "#1E335F",
      onPrimary: "#0E1116",
      danger: "#F87171",
      warning: "#FBBF24",
      success: "#7DD3A8",
      codeText: "#A8C1FF",
      toastBg: "#EEF2FF",
      shadow: "rgba(0, 0, 0, 0.42)",
      focus: "rgba(122, 162, 255, 0.36)"
    }
  }
};

export function normalizeUiTheme(value: unknown): UiTheme {
  return value === "system" || value === "saas" || value === "dark" ? value : "claude";
}

export function getUiTheme(value: unknown): UiThemeDefinition {
  const theme = normalizeUiTheme(value);
  if (theme === "system" && typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches) {
    return UI_THEMES.dark;
  }
  return UI_THEMES[theme];
}
