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
  await writeFile(
    entry,
    `
      export { classifyDevelopmentTransport, isDevelopmentNetworkEvent } from ${JSON.stringify(developmentTrafficPath)};
      export { rankIconifyIds, searchIconifyIconAssets } from ${JSON.stringify(iconifyPath)};
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
