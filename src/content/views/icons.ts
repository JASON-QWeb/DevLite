export function launcherIcon(type: "select" | "panel"): string {
  if (type === "select") {
    return `
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M5 4l8 16 1.9-6.1L21 12 5 4z" />
          <path d="M13.8 13.8l4.4 4.4" />
        </svg>
      `;
  }
  return `
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <rect x="4" y="5" width="16" height="14" rx="2" />
        <path d="M9 5v14" />
        <path d="M12.5 9h4.5" />
        <path d="M12.5 13h4.5" />
      </svg>
    `;
}

export function panelIcon(type: "settings"): string {
  if (type === "settings") {
    return `
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z" />
          <path d="M19.4 15a1.8 1.8 0 0 0 .36 1.98l.05.05a2.2 2.2 0 0 1-3.11 3.11l-.05-.05a1.8 1.8 0 0 0-1.98-.36 1.8 1.8 0 0 0-1.09 1.65V21.5a2.2 2.2 0 0 1-4.4 0v-.12a1.8 1.8 0 0 0-1.09-1.65 1.8 1.8 0 0 0-1.98.36l-.05.05a2.2 2.2 0 0 1-3.11-3.11l.05-.05A1.8 1.8 0 0 0 3.36 15 1.8 1.8 0 0 0 1.7 13.9H1.5a2.2 2.2 0 0 1 0-4.4h.2a1.8 1.8 0 0 0 1.66-1.09 1.8 1.8 0 0 0-.36-1.98l-.05-.05a2.2 2.2 0 0 1 3.11-3.11l.05.05a1.8 1.8 0 0 0 1.98.36A1.8 1.8 0 0 0 9.18 2V1.9a2.2 2.2 0 0 1 4.4 0V2a1.8 1.8 0 0 0 1.09 1.65 1.8 1.8 0 0 0 1.98-.36l.05-.05a2.2 2.2 0 0 1 3.11 3.11l-.05.05a1.8 1.8 0 0 0-.36 1.98 1.8 1.8 0 0 0 1.65 1.09h.25a2.2 2.2 0 0 1 0 4.4h-.25A1.8 1.8 0 0 0 19.4 15z" />
        </svg>
      `;
  }
  return "";
}

export function githubIcon(): string {
  return `
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5a14.6 14.6 0 0 0-8 0C6 2 5 2 5 2a7.9 7.9 0 0 0 0 3.5A5.4 5.4 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65A6 6 0 0 0 9 18v4" />
        <path d="M9 18c-4.5 2-5-2-7-2" />
      </svg>
    `;
}
