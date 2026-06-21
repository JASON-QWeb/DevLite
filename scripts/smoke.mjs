import { readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const dist = join(root, "dist");

const requiredFiles = [
  "manifest.json",
  "background.js",
  "content.js",
  "injected.js",
  "options.html",
  "options.js",
  "_locales/zh_CN/messages.json",
  "_locales/en/messages.json",
  "icons/devlite-16.png",
  "icons/devlite-32.png",
  "icons/devlite-48.png",
  "icons/devlite-128.png"
];

for (const file of requiredFiles) {
  await assertFile(join(dist, file));
}

const manifest = JSON.parse(await readFile(join(dist, "manifest.json"), "utf8"));

assert(manifest.manifest_version === 3, "manifest_version must be 3");
assert(manifest.name === "__MSG_extensionName__", "extension name must use i18n message");
assert(manifest.description === "__MSG_extensionDescription__", "extension description must use i18n message");
assert(manifest.default_locale === "zh_CN", "default locale must be zh_CN");
assert(manifest.background?.service_worker === "background.js", "background service worker path mismatch");
assert(manifest.background?.type === "module", "background service worker must be a module");
assert(!manifest.action?.default_popup, "toolbar action should open the in-page panel directly, not a popup");
const contentScript = manifest.content_scripts?.find((script) => script.js?.includes("content.js"));
assert(contentScript, "content.js must be declared as a static content script");
assert(contentScript.run_at === "document_idle", "content.js should run at document_idle");
for (const origin of ["http://*/*", "https://*/*"]) {
  assert(contentScript.matches?.includes(origin), `content.js must match ${origin}`);
  assert(manifest.host_permissions?.includes(origin), `host_permissions must include ${origin}`);
  assert(!manifest.optional_host_permissions?.includes(origin), `${origin} should not be optional when it is required`);
}
assert(!manifest.optional_host_permissions, "optional_host_permissions should not be declared for the non-AI release");
assert(manifest.icons?.["128"] === "icons/devlite-128.png", "128px icon path mismatch");
assert(manifest.action?.default_icon?.["32"] === "icons/devlite-32.png", "action icon path mismatch");

const permissions = manifest.permissions ?? [];
assert(!permissions.includes("clipboardWrite"), "clipboardWrite should not be requested");
for (const permission of ["debugger", "webRequest", "tabs", "cookies"]) {
  assert(!permissions.includes(permission), `permission ${permission} should not be requested by default`);
}

const contentJs = await readFile(join(dist, "content.js"), "utf8");
const injectedJs = await readFile(join(dist, "injected.js"), "utf8");

assert(!/^\s*import\b/m.test(contentJs), "content.js must not contain top-level import");
assert(!/^\s*export\b/m.test(contentJs), "content.js must not contain top-level export");
assert(!/^\s*import\b/m.test(injectedJs), "injected.js must not contain top-level import");
assert(!/^\s*export\b/m.test(injectedJs), "injected.js must not contain top-level export");

execFileSync(process.execPath, ["--check", join(dist, "content.js")], { stdio: "inherit" });
execFileSync(process.execPath, ["--check", join(dist, "injected.js")], { stdio: "inherit" });
execFileSync(process.execPath, ["--check", join(dist, "background.js")], { stdio: "inherit" });

console.log("DevLite smoke checks passed");

async function assertFile(path) {
  const result = await stat(path).catch(() => null);
  assert(result?.isFile(), `missing required file: ${path}`);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
