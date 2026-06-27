import type { ContentTextKey } from "./i18n";

export type IconAssetCategoryId = "common" | "navigation" | "actions" | "forms" | "media" | "commerce" | "status" | "dev" | "social";

export type IconAssetCategory = {
  id: IconAssetCategoryId;
  labelKey: ContentTextKey;
  queries: string[];
  prefixes: string[];
  localIconIds: string[];
};

export type LocalIconAsset = {
  id: string;
  label: string;
  svg: string;
};

export type OnlineIconAsset = {
  id: string;
  prefix: string;
  name: string;
  label: string;
  svg: string;
};

export type IconAssetPanelViewState = {
  open: boolean;
  activeCategory: IconAssetCategoryId;
  loading: boolean;
  error: string;
  searchQuery: string;
  onlineSearched: boolean;
  onlineIcons: OnlineIconAsset[];
};

export const DEFAULT_ICON_ASSET_CATEGORY: IconAssetCategoryId = "common";

export const ICON_ASSET_CATEGORIES: IconAssetCategory[] = [
  {
    id: "common",
    labelKey: "iconAssetCategoryCommon",
    queries: ["home", "search", "settings", "user", "check", "close"],
    prefixes: ["lucide", "heroicons", "tabler", "mdi"],
    localIconIds: ["home", "search", "settings", "user", "check", "close", "plus", "arrow-right"]
  },
  {
    id: "navigation",
    labelKey: "iconAssetCategoryNavigation",
    queries: ["arrow", "chevron", "menu", "home", "external link"],
    prefixes: ["lucide", "heroicons", "tabler", "mdi"],
    localIconIds: ["menu", "arrow-left", "arrow-right", "chevron-down", "home", "external-link"]
  },
  {
    id: "actions",
    labelKey: "iconAssetCategoryActions",
    queries: ["plus", "edit", "trash", "copy", "download", "upload"],
    prefixes: ["lucide", "heroicons", "tabler", "mdi"],
    localIconIds: ["plus", "edit", "trash", "copy", "download", "upload"]
  },
  {
    id: "forms",
    labelKey: "iconAssetCategoryForms",
    queries: ["mail", "lock", "calendar", "filter", "check", "alert"],
    prefixes: ["lucide", "heroicons", "tabler", "mdi"],
    localIconIds: ["mail", "lock", "calendar", "filter", "check", "alert"]
  },
  {
    id: "media",
    labelKey: "iconAssetCategoryMedia",
    queries: ["image", "video", "play", "pause", "music", "camera"],
    prefixes: ["lucide", "heroicons", "tabler", "mdi"],
    localIconIds: ["image", "video", "play", "pause", "camera", "music"]
  },
  {
    id: "commerce",
    labelKey: "iconAssetCategoryCommerce",
    queries: ["shopping cart", "credit card", "tag", "gift", "wallet", "receipt"],
    prefixes: ["lucide", "heroicons", "tabler", "mdi"],
    localIconIds: ["cart", "credit-card", "tag", "gift", "wallet", "receipt"]
  },
  {
    id: "status",
    labelKey: "iconAssetCategoryStatus",
    queries: ["check circle", "alert", "info", "x circle", "loader", "bell"],
    prefixes: ["lucide", "heroicons", "tabler", "mdi"],
    localIconIds: ["check-circle", "alert", "info", "close-circle", "loader", "bell"]
  },
  {
    id: "dev",
    labelKey: "iconAssetCategoryDev",
    queries: ["code", "file", "folder", "terminal", "database", "bug"],
    prefixes: ["lucide", "heroicons", "tabler", "mdi"],
    localIconIds: ["code", "file", "folder", "terminal", "database", "bug"]
  },
  {
    id: "social",
    labelKey: "iconAssetCategorySocial",
    queries: ["github", "twitter", "linkedin", "share", "message", "heart"],
    prefixes: ["lucide", "simple-icons", "tabler", "mdi"],
    localIconIds: ["github", "share", "message", "heart", "star", "link"]
  }
];

export function getIconAssetCategory(id: string | undefined): IconAssetCategory {
  return ICON_ASSET_CATEGORIES.find((category) => category.id === id) ?? ICON_ASSET_CATEGORIES[0];
}

export function getLocalIconsForCategory(id: IconAssetCategoryId): LocalIconAsset[] {
  return getIconAssetCategory(id).localIconIds.map((iconId) => LOCAL_ICON_ASSETS[iconId]).filter(Boolean);
}

export function getLocalIconAsset(id: string | undefined): LocalIconAsset | null {
  return id ? LOCAL_ICON_ASSETS[id] ?? null : null;
}

function icon(paths: string): string {
  return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
}

const LOCAL_ICON_ASSETS: Record<string, LocalIconAsset> = {
  home: { id: "home", label: "Home", svg: icon('<path d="M3 10.5 12 3l9 7.5"/><path d="M5 10v10h5v-6h4v6h5V10"/>') },
  search: { id: "search", label: "Search", svg: icon('<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>') },
  settings: { id: "settings", label: "Settings", svg: icon('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6V21h-4v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.6-1H3v-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.6V3h4v.1a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.1v4H21a1.7 1.7 0 0 0-1.6 1Z"/>') },
  user: { id: "user", label: "User", svg: icon('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>') },
  check: { id: "check", label: "Check", svg: icon('<path d="m5 12 4 4L19 6"/>') },
  close: { id: "close", label: "Close", svg: icon('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>') },
  plus: { id: "plus", label: "Plus", svg: icon('<path d="M12 5v14"/><path d="M5 12h14"/>') },
  "arrow-left": { id: "arrow-left", label: "Arrow left", svg: icon('<path d="M19 12H5"/><path d="m12 19-7-7 7-7"/>') },
  "arrow-right": { id: "arrow-right", label: "Arrow right", svg: icon('<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>') },
  "chevron-down": { id: "chevron-down", label: "Chevron down", svg: icon('<path d="m6 9 6 6 6-6"/>') },
  menu: { id: "menu", label: "Menu", svg: icon('<path d="M4 7h16"/><path d="M4 12h16"/><path d="M4 17h16"/>') },
  "external-link": { id: "external-link", label: "External link", svg: icon('<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5"/>') },
  edit: { id: "edit", label: "Edit", svg: icon('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>') },
  trash: { id: "trash", label: "Trash", svg: icon('<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v5"/><path d="M14 11v5"/>') },
  copy: { id: "copy", label: "Copy", svg: icon('<rect x="9" y="9" width="11" height="11" rx="2"/><rect x="4" y="4" width="11" height="11" rx="2"/>') },
  download: { id: "download", label: "Download", svg: icon('<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>') },
  upload: { id: "upload", label: "Upload", svg: icon('<path d="M12 21V9"/><path d="m7 14 5-5 5 5"/><path d="M5 3h14"/>') },
  mail: { id: "mail", label: "Mail", svg: icon('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>') },
  lock: { id: "lock", label: "Lock", svg: icon('<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>') },
  calendar: { id: "calendar", label: "Calendar", svg: icon('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4"/><path d="M8 3v4"/><path d="M3 11h18"/>') },
  filter: { id: "filter", label: "Filter", svg: icon('<path d="M4 5h16"/><path d="M7 12h10"/><path d="M10 19h4"/>') },
  alert: { id: "alert", label: "Alert", svg: icon('<path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.3 3.9 2.8 18a2 2 0 0 0 1.8 3h14.8a2 2 0 0 0 1.8-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/>') },
  image: { id: "image", label: "Image", svg: icon('<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10" r="1.5"/><path d="m21 15-5-5L5 19"/>') },
  video: { id: "video", label: "Video", svg: icon('<rect x="3" y="6" width="13" height="12" rx="2"/><path d="m16 10 5-3v10l-5-3z"/>') },
  play: { id: "play", label: "Play", svg: icon('<path d="m8 5 11 7-11 7z"/>') },
  pause: { id: "pause", label: "Pause", svg: icon('<path d="M8 5v14"/><path d="M16 5v14"/>') },
  camera: { id: "camera", label: "Camera", svg: icon('<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="4"/>') },
  music: { id: "music", label: "Music", svg: icon('<path d="M9 18V5l10-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="16" cy="16" r="3"/>') },
  cart: { id: "cart", label: "Cart", svg: icon('<circle cx="9" cy="20" r="1"/><circle cx="18" cy="20" r="1"/><path d="M2 3h3l3 12h10l3-8H6"/>') },
  "credit-card": { id: "credit-card", label: "Credit card", svg: icon('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18"/><path d="M7 15h3"/>') },
  tag: { id: "tag", label: "Tag", svg: icon('<path d="M20 13 12 21 3 12V3h9l8 8a1.5 1.5 0 0 1 0 2Z"/><circle cx="7.5" cy="7.5" r="1"/>') },
  gift: { id: "gift", label: "Gift", svg: icon('<rect x="3" y="8" width="18" height="13" rx="2"/><path d="M12 8v13"/><path d="M3 13h18"/><path d="M12 8H8a2.5 2.5 0 1 1 4-2Z"/><path d="M12 8h4a2.5 2.5 0 1 0-4-2Z"/>') },
  wallet: { id: "wallet", label: "Wallet", svg: icon('<path d="M4 7h15a2 2 0 0 1 2 2v10H4a2 2 0 0 1-2-2V5a2 2 0 0 0 2 2Z"/><path d="M16 13h.01"/>') },
  receipt: { id: "receipt", label: "Receipt", svg: icon('<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6"/><path d="M9 12h6"/><path d="M9 16h4"/>') },
  "check-circle": { id: "check-circle", label: "Check circle", svg: icon('<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>') },
  "close-circle": { id: "close-circle", label: "Close circle", svg: icon('<circle cx="12" cy="12" r="9"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>') },
  info: { id: "info", label: "Info", svg: icon('<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 8h.01"/>') },
  loader: { id: "loader", label: "Loader", svg: icon('<path d="M12 2v4"/><path d="M12 18v4"/><path d="m4.9 4.9 2.8 2.8"/><path d="m16.3 16.3 2.8 2.8"/><path d="M2 12h4"/><path d="M18 12h4"/>') },
  bell: { id: "bell", label: "Bell", svg: icon('<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/>') },
  code: { id: "code", label: "Code", svg: icon('<path d="m8 9-4 3 4 3"/><path d="m16 9 4 3-4 3"/><path d="m14 5-4 14"/>') },
  file: { id: "file", label: "File", svg: icon('<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v5h5"/>') },
  folder: { id: "folder", label: "Folder", svg: icon('<path d="M3 7h7l2 2h9v10H3z"/>') },
  terminal: { id: "terminal", label: "Terminal", svg: icon('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m7 10 3 2-3 2"/><path d="M12 15h5"/>') },
  database: { id: "database", label: "Database", svg: icon('<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>') },
  bug: { id: "bug", label: "Bug", svg: icon('<path d="M8 6h8"/><path d="M9 6a3 3 0 0 1 6 0"/><rect x="7" y="8" width="10" height="12" rx="4"/><path d="M3 13h4"/><path d="M17 13h4"/><path d="M4 19l3-2"/><path d="m20 19-3-2"/>') },
  github: { id: "github", label: "GitHub", svg: icon('<path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.1-1.3-.3-2.5-1-3.5.3-1.2.3-2.4 0-3.5 0 0-1 0-3 1.5a14.6 14.6 0 0 0-8 0C6 2 5 2 5 2a7.9 7.9 0 0 0 0 3.5A5.4 5.4 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.4.5-.7 1.1-.9 1.7A6 6 0 0 0 9 18v4"/><path d="M9 18c-4.5 2-5-2-7-2"/>') },
  share: { id: "share", label: "Share", svg: icon('<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 10.5 6.8-4"/><path d="m8.6 13.5 6.8 4"/>') },
  message: { id: "message", label: "Message", svg: icon('<path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"/>') },
  heart: { id: "heart", label: "Heart", svg: icon('<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 1 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8Z"/>') },
  star: { id: "star", label: "Star", svg: icon('<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3l-5.6 2.9 1.1-6.2L3 9.6l6.2-.9z"/>') },
  link: { id: "link", label: "Link", svg: icon('<path d="M10 13a5 5 0 0 0 7.1 0l2-2a5 5 0 0 0-7.1-7.1l-1.1 1.1"/><path d="M14 11a5 5 0 0 0-7.1 0l-2 2a5 5 0 0 0 7.1 7.1l1.1-1.1"/>') }
};
