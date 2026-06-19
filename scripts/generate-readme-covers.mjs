import { execFile, spawn } from "node:child_process";
import { createServer } from "node:net";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const root = resolve(import.meta.dirname, "..");
const distDir = join(root, "dist");
const demoDir = join(root, "demo/devlite-qa");
const outputDir = join(root, "docs/assets");
const chromeCacheDir = join(tmpdir(), "devlite-browsers/chrome");
const execFileAsync = promisify(execFile);
const chromePath = await findChromeExecutable();

const captureSize = { width: 1440, height: 900 };
const coverSize = { width: 1600, height: 800 };
const coverRenderScale = 2;

const covers = [
  {
    lang: "zh-CN",
    filename: "readme-cover-zh.png",
    subtitle: "告别学习开发者工具",
    features: [
      "页面元素直接编辑",
      "文字 / 样式 / 图片实时修改",
      "Console / Network / Performance 诊断",
      "一键复制 Agent 修复 Prompt"
    ]
  },
  {
    lang: "en",
    filename: "readme-cover-en.png",
    subtitle: "Skip learning DevTools",
    features: [
      "Edit page elements directly",
      "Live text, style, and image changes",
      "Console, Network, and Performance diagnostics",
      "Copy agent-ready repair prompts"
    ]
  }
];

class CdpSession {
  static connect(url) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      const session = new CdpSession(ws);
      ws.addEventListener("open", () => resolve(session), { once: true });
      ws.addEventListener("error", (event) => reject(new Error(`WebSocket error: ${event.message || "unknown"}`)), { once: true });
    });
  }

  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    ws.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (!message.id) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) {
        pending.reject(new Error(message.error.message || JSON.stringify(message.error)));
      } else {
        pending.resolve(message.result);
      }
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    const payload = JSON.stringify({ id, method, params });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timed out waiting for CDP response: ${method}`));
      }, 15000);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(payload);
    });
  }

  close() {
    this.ws.close();
    return Promise.resolve();
  }
}

if (!chromePath) {
  throw new Error("Chrome executable not found. Set CHROME_BIN or install Chrome for Testing.");
}

if (!existsSync(join(distDir, "manifest.json"))) {
  throw new Error("dist/manifest.json not found. Run npm run build first.");
}

await mkdir(outputDir, { recursive: true });

const demoPort = await freePort();
const cdpPort = await freePort();
const profileDir = await mkdtemp(join(tmpdir(), "devlite-readme-chrome-"));
const extensionRoot = await mkdtemp(join(tmpdir(), "devlite-readme-extension-"));
const compositionDir = await mkdtemp(join(tmpdir(), "devlite-readme-compose-"));
const extensionDir = join(extensionRoot, "extension");
const demoUrl = `http://127.0.0.1:${demoPort}/?theme=orbit`;

let demoProcess;
let chromeProcess;
let page;

try {
  await cp(distDir, extensionDir, { recursive: true });
  demoProcess = spawn(process.execPath, ["server.mjs"], {
    cwd: demoDir,
    env: { ...process.env, PORT: String(demoPort) },
    stdio: ["ignore", "pipe", "pipe"]
  });
  demoProcess.stdout.on("data", (chunk) => process.stdout.write(`[demo] ${chunk}`));
  demoProcess.stderr.on("data", (chunk) => process.stderr.write(`[demo] ${chunk}`));
  await waitForHttp(`http://127.0.0.1:${demoPort}`, "demo server");

  chromeProcess = spawn(
    chromePath,
    [
      `--user-data-dir=${profileDir}`,
      `--remote-debugging-port=${cdpPort}`,
      `--disable-extensions-except=${extensionDir}`,
      `--load-extension=${extensionDir}`,
      "--enable-unsafe-extension-debugging",
      "--disable-features=DisableLoadExtensionCommandLineSwitch",
      "--no-first-run",
      "--disable-default-apps",
      "--disable-popup-blocking",
      "--disable-gpu",
      "--force-color-profile=srgb",
      "--lang=zh-CN",
      `--window-size=${captureSize.width},${captureSize.height + 80}`,
      demoUrl
    ],
    { stdio: ["ignore", "pipe", "pipe"] }
  );
  chromeProcess.stdout.on("data", (chunk) => process.stdout.write(`[chrome] ${chunk}`));
  chromeProcess.stderr.on("data", (chunk) => process.stderr.write(`[chrome] ${chunk}`));

  await waitForHttp(`http://127.0.0.1:${cdpPort}/json/version`, "Chrome DevTools");
  const target = await waitForTarget(cdpPort, (item) => item.type === "page" && item.url.startsWith(`http://127.0.0.1:${demoPort}`), "demo page target");
  page = await CdpSession.connect(target.webSocketDebuggerUrl);
  await page.send("Runtime.enable");
  await page.send("Page.enable");
  await page.send("DOM.enable");
  await page.send("Emulation.setDeviceMetricsOverride", { ...captureSize, deviceScaleFactor: 2, mobile: false });
  await page.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] });
  await waitForEval(page, "document.readyState === 'complete'", "demo page loaded");
  await waitForEval(page, 'document.documentElement.dataset.theme === "orbit"', "orbit theme applied");

  await ensureLauncher(page, `http://127.0.0.1:${demoPort}`);
  await shadowClick(page, ".devlite-launcher");
  await waitForEval(page, "!!document.querySelector('#devlite-overlay-root')?.shadowRoot?.querySelector('.devlite-panel:not([hidden])')", "panel opens");
  await prepareNetworkPreview(page);

  const preview = await capturePagePng(page);
  const icon = await readFile(join(root, "public/icons/devlite-ui-256.png"));

  for (const cover of covers) {
    const html = coverHtml(preview.toString("base64"), icon.toString("base64"), cover);
    const outputPath = join(outputDir, cover.filename);
    await renderHtmlToPng(html, coverSize, outputPath);
    console.log(`wrote ${outputPath}`);
  }
} finally {
  await page?.close().catch(() => null);
  if (chromeProcess && !chromeProcess.killed) chromeProcess.kill("SIGTERM");
  if (demoProcess && !demoProcess.killed) demoProcess.kill("SIGTERM");
  await rm(profileDir, { recursive: true, force: true }).catch(() => null);
  await rm(extensionRoot, { recursive: true, force: true }).catch(() => null);
  await rm(compositionDir, { recursive: true, force: true }).catch(() => null);
}

async function prepareNetworkPreview(pageSession) {
  await openPanelTab(pageSession, "network");
  await evaluate(
    pageSession,
    `
      (() => {
        for (const id of ["fetch-ok", "fetch-post", "fetch-error", "fetch-slow", "fetch-large", "xhr-ok"]) {
          document.getElementById(id)?.click();
        }
        return true;
      })()
    `
  );
  await delay(3400);
  await evaluate(pageSession, `document.getElementById("fetch-ok")?.click(); true;`);
  await delay(900);
  await shadowClickText(pageSession, ".network-row", "/api/profile");
  await shadowClick(pageSession, 'button[data-network-detail="request"]');
  await waitForEval(pageSession, "document.querySelector('#devlite-overlay-root')?.shadowRoot?.textContent.includes('/api/profile')", "network request visible");
  await setPanelFrame(pageSession);
}

async function openPanelTab(pageSession, tab) {
  await evaluate(
    pageSession,
    `
      (() => {
        const root = document.querySelector("#devlite-overlay-root")?.shadowRoot;
        const panel = root?.querySelector(".devlite-panel");
        if (panel?.hidden) root?.querySelector(".devlite-launcher")?.click();
        const editor = root?.querySelector(".style-editor-popover:not([hidden])");
        if (editor) editor.querySelector('[data-style-action="back-panel"]')?.click();
        return true;
      })()
    `
  );
  await waitForEval(pageSession, "!!document.querySelector('#devlite-overlay-root')?.shadowRoot?.querySelector('.devlite-panel:not([hidden])')", "panel visible");
  await shadowClick(pageSession, `button[data-tab="${tab}"]`);
  await setPanelFrame(pageSession);
}

async function setPanelFrame(pageSession) {
  await evaluate(
    pageSession,
    `
      (() => {
        const root = document.querySelector("#devlite-overlay-root")?.shadowRoot;
        const panel = root?.querySelector(".devlite-panel");
        if (!panel) return false;
        panel.style.width = "790px";
        panel.style.height = "790px";
        panel.style.top = "28px";
        panel.style.right = "28px";
        panel.style.left = "auto";
        return true;
      })()
    `
  );
}

async function renderHtmlToPng(html, size, outputPath) {
  const htmlPath = join(compositionDir, `compose-${Date.now()}-${Math.random().toString(36).slice(2)}.html`);
  await writeFile(htmlPath, html);
  await execFileAsync(
    chromePath,
    [
      "--headless=new",
      "--disable-gpu",
      "--hide-scrollbars",
      "--force-color-profile=srgb",
      `--force-device-scale-factor=${coverRenderScale}`,
      "--run-all-compositor-stages-before-draw",
      "--virtual-time-budget=1400",
      `--window-size=${size.width},${size.height}`,
      `--screenshot=${outputPath}`,
      pathToFileURL(htmlPath).href
    ],
    { timeout: 30000 }
  );
}

async function capturePagePng(session) {
  await delay(250);
  const screenshot = await session.send("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
    captureBeyondViewport: false
  });
  return Buffer.from(screenshot.data, "base64");
}

function coverHtml(shotBase64, iconBase64, cover) {
  const featureItems = cover.features.map((feature) => `<li>${escapeHtml(feature)}</li>`).join("");
  return `<!doctype html>
<html lang="${escapeHtml(cover.lang)}">
<head>
  <meta charset="utf-8" />
  <style>
    * { box-sizing: border-box; }
    html, body { width: 1600px; height: 800px; margin: 0; overflow: hidden; }
    body {
      position: relative;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", Arial, sans-serif;
      color: #fffaf3;
      background:
        radial-gradient(circle at 12% 36%, rgba(37, 82, 117, .28), transparent 24%),
        radial-gradient(circle at 86% 18%, rgba(217, 119, 87, .18), transparent 30%),
        linear-gradient(132deg, #141413 0%, #1d1a16 52.4%, #f2d4c8 52.6%, #fbf3ec 100%);
    }
    body::before {
      content: "";
      position: absolute;
      inset: 0;
      background:
        linear-gradient(90deg, rgba(255, 250, 243, .045) 1px, transparent 1px),
        linear-gradient(180deg, rgba(255, 250, 243, .035) 1px, transparent 1px);
      background-size: 56px 56px;
      opacity: .22;
      pointer-events: none;
    }
    body::after {
      content: "";
      position: absolute;
      inset: 0;
      background: linear-gradient(90deg, rgba(20, 20, 19, .08), transparent 48%, rgba(255, 255, 255, .2));
      pointer-events: none;
    }
    .brand {
      position: absolute;
      left: 98px;
      top: 132px;
      display: flex;
      align-items: center;
      gap: 34px;
      z-index: 2;
    }
    .brand img {
      width: 124px;
      height: 124px;
      border-radius: 30px;
      box-shadow: 0 30px 74px rgba(0, 0, 0, .34);
    }
    .brand strong {
      display: block;
      font-size: 94px;
      line-height: .94;
      letter-spacing: 0;
      font-weight: 780;
      color: #fffaf3;
      text-shadow: 0 18px 50px rgba(0, 0, 0, .22);
    }
    .brand span {
      display: block;
      margin-top: 18px;
      max-width: 640px;
      color: rgba(255, 250, 243, .78);
      font-size: 34px;
      line-height: 1.12;
      letter-spacing: 0;
      font-weight: 720;
    }
    .features {
      position: absolute;
      left: 112px;
      top: 360px;
      z-index: 2;
      width: 540px;
      margin: 0;
      padding: 0;
      list-style: none;
      display: grid;
      gap: 20px;
    }
    .features li {
      position: relative;
      padding-left: 30px;
      color: rgba(255, 250, 243, .86);
      font-size: 28px;
      line-height: 1.18;
      letter-spacing: 0;
      font-weight: 690;
    }
    .features li::before {
      content: "";
      position: absolute;
      left: 0;
      top: .44em;
      width: 12px;
      height: 12px;
      border-radius: 4px;
      background: #d97757;
      box-shadow: 0 0 0 5px rgba(217, 119, 87, .16);
    }
    .accent-line {
      position: absolute;
      left: 98px;
      bottom: 86px;
      z-index: 2;
      width: 460px;
      height: 10px;
      border-radius: 999px;
      background: linear-gradient(90deg, #e8795e, #d97757);
      box-shadow: 0 14px 34px rgba(217, 119, 87, .26);
    }
    .preview-shell {
      position: absolute;
      right: 64px;
      top: 168px;
      z-index: 2;
      width: 880px;
      height: 548px;
      padding: 12px;
      border-radius: 18px;
      background: rgba(255, 255, 255, .54);
      box-shadow: 0 48px 120px rgba(42, 28, 20, .34);
      transform: rotate(-3deg);
    }
    .preview-shell::before {
      content: "";
      position: absolute;
      inset: -1px;
      border: 1px solid rgba(255, 255, 255, .7);
      border-radius: 18px;
      pointer-events: none;
    }
    .preview {
      display: block;
      width: 100%;
      height: 100%;
      border-radius: 10px;
      object-fit: cover;
      object-position: 66% 50%;
      background: #fffaf3;
    }
  </style>
</head>
<body>
  <section class="brand" aria-label="DevLite">
    <img src="data:image/png;base64,${iconBase64}" alt="" />
    <div>
      <strong>DevLite</strong>
      <span>${escapeHtml(cover.subtitle)}</span>
    </div>
  </section>
  <ul class="features">${featureItems}</ul>
  <div class="accent-line"></div>
  <div class="preview-shell">
    <img class="preview" src="data:image/png;base64,${shotBase64}" alt="" />
  </div>
  <script>
    Promise.all(Array.from(document.images).map((img) => img.complete ? true : new Promise((resolve) => {
      img.addEventListener("load", resolve, { once: true });
      img.addEventListener("error", resolve, { once: true });
    }))).then(() => { window.__ready = true; });
  </script>
</body>
</html>`;
}

async function shadowClick(session, selector) {
  const ok = await evaluate(
    session,
    `
      (() => {
        const root = document.querySelector("#devlite-overlay-root")?.shadowRoot;
        const node = root?.querySelector(${JSON.stringify(selector)});
        if (!node) return false;
        node.click();
        return true;
      })()
    `
  );
  assert(ok, `shadow click failed: ${selector}`);
  await delay(140);
}

async function shadowClickText(session, selector, text) {
  const ok = await evaluate(
    session,
    `
      (() => {
        const root = document.querySelector("#devlite-overlay-root")?.shadowRoot;
        const nodes = Array.from(root?.querySelectorAll(${JSON.stringify(selector)}) ?? []);
        const node = nodes.find((item) => item.textContent.includes(${JSON.stringify(text)}));
        if (!node) return false;
        node.click();
        return true;
      })()
    `
  );
  assert(ok, `shadow text click failed: ${selector} includes ${text}`);
  await delay(140);
}

async function waitForEval(session, expression, label, timeout = 8000) {
  return waitFor(async () => Boolean(await evaluate(session, expression).catch(() => false)), label, timeout);
}

async function evaluate(session, expression) {
  const response = await session.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true
  });
  if (response.exceptionDetails) {
    const text = response.exceptionDetails.exception?.description || response.exceptionDetails.text;
    throw new Error(text);
  }
  return response.result?.value;
}

async function ensureLauncher(pageSession, pageUrlPrefix) {
  const hasLauncher = "!!document.querySelector('#devlite-overlay-root')?.shadowRoot?.querySelector('.devlite-dock')";
  const autoInjected = await waitForEval(pageSession, hasLauncher, "DevLite launcher auto injection", 3000).then(
    () => true,
    () => false
  );
  if (autoInjected) return;
  await pageSession.send("Page.reload", { ignoreCache: true });
  await waitForEval(
    pageSession,
    `location.href.startsWith(${JSON.stringify(pageUrlPrefix)}) && document.readyState === "complete"`,
    "demo page reloads after extension startup",
    10000
  );
  await waitForEval(pageSession, hasLauncher, "DevLite launcher exists after reload", 10000);
}

async function waitForTarget(port, predicate, label, timeout = 8000) {
  return waitFor(async () => {
    const targets = await listTargets(port);
    return targets.find(predicate) || null;
  }, label, timeout);
}

async function listTargets(port) {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`);
  return response.json();
}

async function waitForHttp(url, label, timeout = 8000) {
  return waitFor(async () => {
    const response = await fetch(url).catch(() => null);
    return response?.ok ? true : null;
  }, label, timeout);
}

async function waitFor(fn, label, timeout = 8000) {
  const started = Date.now();
  let lastError;
  while (Date.now() - started < timeout) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await delay(120);
  }
  throw new Error(`Timed out waiting for ${label}${lastError ? `: ${lastError.message}` : ""}`);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

async function findChromeExecutable() {
  if (process.env.CHROME_BIN) {
    return existsSync(process.env.CHROME_BIN) ? process.env.CHROME_BIN : "";
  }

  const chromeForTesting = [
    ...findChromeForTestingExecutables(chromeCacheDir),
    "/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"
  ].find((path) => path && existsSync(path));
  if (chromeForTesting) return chromeForTesting;

  return installChromeForTesting(chromeCacheDir);
}

function findChromeForTestingExecutables(baseDir) {
  if (!existsSync(baseDir)) return [];
  const platform = chromeForTestingPlatform();
  const candidates = [];
  for (const buildDir of safeReadDir(baseDir)) {
    candidates.push(chromeForTestingExecutable(baseDir, buildDir, platform));
  }
  return candidates;
}

async function installChromeForTesting(baseDir) {
  const platform = chromeForTestingPlatform();
  const manifest = await fetch("https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions-with-downloads.json").then(
    (response) => {
      if (!response.ok) throw new Error(`Chrome for Testing manifest fetch failed: ${response.status}`);
      return response.json();
    }
  );
  const stable = manifest.channels?.Stable;
  const download = stable?.downloads?.chrome?.find((item) => item.platform === platform);
  if (!stable?.version || !download?.url) {
    throw new Error(`Chrome for Testing download not found for ${platform}`);
  }

  const executable = chromeForTestingExecutable(baseDir, stable.version, platform);
  if (existsSync(executable)) return executable;

  await mkdir(baseDir, { recursive: true });
  const archivePath = join(baseDir, `chrome-${stable.version}-${platform}.zip`);
  const archive = await fetch(download.url).then(async (response) => {
    if (!response.ok) throw new Error(`Chrome for Testing download failed: ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  });
  await writeFile(archivePath, archive);
  await execFileAsync("unzip", ["-q", "-o", archivePath, "-d", join(baseDir, stable.version)]);

  if (!existsSync(executable)) {
    throw new Error(`Chrome for Testing executable not found after install: ${executable}`);
  }
  return executable;
}

function chromeForTestingPlatform() {
  if (process.platform === "darwin") return process.arch === "arm64" ? "mac-arm64" : "mac-x64";
  if (process.platform === "linux") return "linux64";
  if (process.platform === "win32") return process.arch === "x64" ? "win64" : "win32";
  throw new Error(`Unsupported platform for Chrome for Testing: ${process.platform}/${process.arch}`);
}

function chromeForTestingExecutable(baseDir, version, platform) {
  if (platform === "mac-arm64" || platform === "mac-x64") {
    return join(baseDir, version, `chrome-${platform}/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`);
  }
  if (platform === "linux64") {
    return join(baseDir, version, "chrome-linux64/chrome");
  }
  return join(baseDir, version, `chrome-${platform}/chrome.exe`);
}

function safeReadDir(path) {
  try {
    return readdirSync(path);
  } catch {
    return [];
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
