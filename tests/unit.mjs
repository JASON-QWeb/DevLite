import { strict as assert } from "node:assert";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = resolve(import.meta.dirname, "..");
const tempDir = await mkdtemp(join(tmpdir(), "devlite-unit-"));

try {
  const modules = await bundleSharedModules();
  testDevelopmentTraffic(modules);
  testPanelPosition(modules);
  await testIconifySearch(modules);
  console.log("DevLite unit checks passed");
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

async function bundleSharedModules() {
  const entry = join(tempDir, "entry.ts");
  const outfile = join(tempDir, "entry.mjs");
  const developmentTrafficPath = moduleSpecifier(entry, join(root, "src/shared/developmentTraffic.ts"));
  const iconifyPath = moduleSpecifier(entry, join(root, "src/shared/iconify.ts"));
  const panelPositionPath = moduleSpecifier(entry, join(root, "src/content/panelPosition.ts"));
  await writeFile(
    entry,
    `
      export { classifyDevelopmentTransport, isDevelopmentNetworkEvent } from ${JSON.stringify(developmentTrafficPath)};
      export { rankIconifyIds, searchIconifyIconAssets } from ${JSON.stringify(iconifyPath)};
      export { DEFAULT_PANEL_HEIGHT, DEFAULT_PANEL_WIDTH, clampPanelHeight, clampPanelWidth, resolvePanelSize } from ${JSON.stringify(panelPositionPath)};
    `
  );
  await build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node22",
    logLevel: "silent"
  });
  return import(pathToFileURL(outfile).href);
}

function moduleSpecifier(fromFile, targetFile) {
  void fromFile;
  return targetFile.replaceAll("\\", "/");
}

function testDevelopmentTraffic(modules) {
  assert.deepEqual(
    modules.classifyDevelopmentTransport("ws://localhost:5173/", [], "websocket"),
    { devTransport: "local-dev-ws" },
    "absolute local dev WebSocket URL should classify without relying on global location"
  );
  assert.deepEqual(
    modules.classifyDevelopmentTransport("/ws", [], "websocket"),
    {},
    "relative URLs without a safe base should not be parsed against extension or Node globals"
  );
  assert.deepEqual(
    modules.classifyDevelopmentTransport("/ws", [], "websocket", "http://localhost:5173/page"),
    { devTransport: "local-dev-ws" },
    "relative local dev WebSocket URL should classify with an explicit base"
  );
  assert.deepEqual(
    modules.classifyDevelopmentTransport("ws://example.test/socket", ["nextdoor"], "websocket"),
    {},
    "generic protocols containing next should not be treated as Next.js HMR"
  );
  assert.deepEqual(
    modules.classifyDevelopmentTransport("ws://example.test/socket", ["next-hmr"], "websocket"),
    { devTransport: "next-hmr" },
    "explicit Next.js HMR protocol should classify"
  );
  assert.equal(
    modules.isDevelopmentNetworkEvent({
      type: "network",
      metadata: { devTransport: "vite-hmr" }
    }),
    true,
    "pre-classified development traffic should remain development traffic"
  );
}

function testPanelPosition(modules) {
  assert.deepEqual(
    modules.resolvePanelSize({}, { width: 1440, height: 900 }),
    { width: 920, height: 680 },
    "initial panel size should use the larger desktop default when no saved size exists"
  );
  assert.equal(modules.DEFAULT_PANEL_WIDTH, 920, "default panel width should stay large enough for two-column content");
  assert.equal(modules.DEFAULT_PANEL_HEIGHT, 680, "default panel height should show enough tab content on first open");
  assert.deepEqual(
    modules.resolvePanelSize({ width: 640, height: 500 }, { width: 1440, height: 900 }),
    { width: 640, height: 500 },
    "saved user-resized panel dimensions should be preserved"
  );
  assert.deepEqual(
    modules.resolvePanelSize({}, { width: 800, height: 600 }),
    { width: 768, height: 568 },
    "initial panel size should clamp to the viewport with a 16px edge gap"
  );
  assert.equal(modules.clampPanelWidth(100, 1440), 320, "panel width should not shrink below the desktop minimum");
  assert.equal(modules.clampPanelHeight(100, 900), 280, "panel height should not shrink below the desktop minimum");
}

async function testIconifySearch(modules) {
  let activeSearches = 0;
  let maxActiveSearches = 0;
  const searchCalls = [];
  const assetCalls = [];
  const idsByQuery = {
    home: ["mdi:home", "lucide:home", "bad-id"],
    user: ["tabler:user", "lucide:user"],
    many: ["mdi:a", "lucide:a", "heroicons:a", "tabler:a", "mdi:b", "lucide:b"]
  };
  const deps = {
    assetConcurrency: 8,
    fetchSearchIds: async (query) => {
      searchCalls.push(query);
      activeSearches += 1;
      maxActiveSearches = Math.max(maxActiveSearches, activeSearches);
      await delay(query === "home" ? 20 : 5);
      activeSearches -= 1;
      if (query === "fail") throw new Error("search failed");
      return idsByQuery[query] ?? [];
    },
    fetchAsset: async (id) => {
      assetCalls.push(id);
      const [prefix, name] = id.split(":");
      return { id, prefix, name, label: name, svg: `<svg viewBox="0 0 24 24"><path d="M0 0h1v1"/></svg>` };
    }
  };

  const icons = await modules.searchIconifyIconAssets(
    { queries: ["home", "fail", "user"], prefixes: ["lucide"], limit: 2 },
    deps
  );
  assert(maxActiveSearches > 1, "Iconify search queries should run in parallel");
  assert.deepEqual(searchCalls.sort(), ["fail", "home", "user"], "all requested queries should be attempted");
  assert.deepEqual(
    icons.map((icon) => icon.id),
    ["lucide:home", "lucide:user"],
    "preferred prefixes should be ranked before other providers"
  );
  assert.deepEqual(
    assetCalls,
    ["lucide:home", "lucide:user", "mdi:home", "tabler:user"],
    "asset fetch candidates should be limited to limit * 2 and keep ranked order"
  );

  await assert.rejects(
    () =>
      modules.searchIconifyIconAssets(
        {
          queries: ["fail"],
          prefixes: ["lucide"],
          limit: 2
        },
        deps
      ),
    /Iconify search failed/,
    "all failed queries should surface a search error"
  );

  assert.deepEqual(
    modules.rankIconifyIds(["mdi:home", "lucide:home", "mdi:home", "tabler:home"], ["lucide", "tabler"]),
    ["lucide:home", "tabler:home", "mdi:home"],
    "ranking should dedupe IDs and keep preferred prefixes first"
  );
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
