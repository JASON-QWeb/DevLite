import { execFile, spawn } from "node:child_process";
import { createServer } from "node:net";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const root = resolve(import.meta.dirname, "..");
const distDir = join(root, "dist");
const demoDir = join(root, "demo/devlite-qa");
const outputDir = join(root, "store-assets/chrome-web-store");
const chromeCacheDir = join(tmpdir(), "devlite-browsers/chrome");
const execFileAsync = promisify(execFile);
const chromePath = await findChromeExecutable();

const screenshotSize = { width: 1280, height: 800 };
const smallPromoSize = { width: 440, height: 280 };
const marqueeSize = { width: 1400, height: 560 };

const featureShots = [
  {
    filename: "01-text-editing-1280x800.png",
    label: "页面直接修改",
    title: "改样式、换文字图片，不用进 DevTools",
    caption: "选中元素即可调整颜色、字号、圆角，也能替换文案和图片。"
  },
  {
    filename: "02-multi-element-prompt-1280x800.png",
    label: "Prompt 导出",
    title: "多个元素改动，一次复制修复 Prompt",
    caption: "文字、样式和元素定位被整理成 Agent 可执行任务。"
  },
  {
    filename: "03-data-capture-1280x800.png",
    label: "数据获取",
    title: "Fetch / XHR 请求和响应一起看",
    caption: "定位接口、状态、耗时、请求头和响应体。"
  },
  {
    filename: "04-performance-diagnostics-1280x800.png",
    label: "性能诊断",
    title: "慢请求、长任务和资源证据自动归档",
    caption: "把性能问题转成可复制的修复 Prompt。"
  },
  {
    filename: "05-log-diagnostics-1280x800.png",
    label: "Log 诊断",
    title: "Console log 与页面问题集中查看",
    caption: "复现过程中产生的日志、错误和异常不再散落在 DevTools 里。"
  }
];

class CdpSession {
  static async fromVersion(port) {
    const version = await fetch(`http://127.0.0.1:${port}/json/version`).then((response) => response.json());
    return CdpSession.connect(version.webSocketDebuggerUrl);
  }

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
    this.eventWaiters = new Map();
    ws.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        clearTimeout(pending.timer);
        if (message.error) {
          pending.reject(new Error(message.error.message || JSON.stringify(message.error)));
        } else {
          pending.resolve(message.result);
        }
        return;
      }
      if (message.method) {
        this.resolveEventWaiters(message.method, message.params ?? {});
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

  async createTarget(url) {
    const response = await this.send("Target.createTarget", { url });
    return response.targetId;
  }

  waitForEvent(method, predicate = () => true, timeout = 8000) {
    return new Promise((resolve, reject) => {
      const waiter = {
        predicate,
        resolve,
        timer: setTimeout(() => {
          const waiters = this.eventWaiters.get(method) ?? [];
          this.eventWaiters.set(
            method,
            waiters.filter((item) => item !== waiter)
          );
          reject(new Error(`Timed out waiting for CDP event ${method}`));
        }, timeout)
      };
      const waiters = this.eventWaiters.get(method) ?? [];
      waiters.push(waiter);
      this.eventWaiters.set(method, waiters);
    });
  }

  resolveEventWaiters(method, params) {
    const waiters = this.eventWaiters.get(method) ?? [];
    const remaining = [];
    for (const waiter of waiters) {
      if (waiter.predicate(params)) {
        clearTimeout(waiter.timer);
        waiter.resolve(params);
      } else {
        remaining.push(waiter);
      }
    }
    this.eventWaiters.set(method, remaining);
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
const profileDir = await mkdtemp(join(tmpdir(), "devlite-store-chrome-"));
const extensionRoot = await mkdtemp(join(tmpdir(), "devlite-store-extension-"));
const compositionDir = await mkdtemp(join(tmpdir(), "devlite-store-compose-"));
const extensionDir = join(extensionRoot, "extension");
const demoUrl = `http://127.0.0.1:${demoPort}`;

let demoProcess;
let chromeProcess;
let browser;
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
  await waitForHttp(demoUrl, "demo server");

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
      "--window-size=1400,960",
      demoUrl
    ],
    { stdio: ["ignore", "pipe", "pipe"] }
  );
  chromeProcess.stdout.on("data", (chunk) => process.stdout.write(`[chrome] ${chunk}`));
  chromeProcess.stderr.on("data", (chunk) => process.stderr.write(`[chrome] ${chunk}`));

  await waitForHttp(`http://127.0.0.1:${cdpPort}/json/version`, "Chrome DevTools");
  browser = await CdpSession.fromVersion(cdpPort);
  const extensionId = await waitForExtensionId(browser, profileDir, extensionDir);
  console.log(`extension id ${extensionId}`);
  await setExtensionDefaults(browser, cdpPort, extensionId);
  console.log("extension defaults written");

  const target = await waitForTarget(cdpPort, (item) => item.type === "page" && item.url.startsWith(demoUrl), "demo page target");
  page = await CdpSession.connect(target.webSocketDebuggerUrl);
  await page.send("Runtime.enable");
  await page.send("Page.enable");
  await page.send("DOM.enable");
  await page.send("Emulation.setDeviceMetricsOverride", { ...screenshotSize, deviceScaleFactor: 1, mobile: false });
  await page.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] });
  await waitForEval(page, "document.readyState === 'complete'", "demo page loaded");
  console.log("demo page connected");

  await ensureLauncher(page, demoUrl);
  console.log("launcher ready");
  await shadowClick(page, ".devlite-launcher");
  await waitForEval(page, "!!document.querySelector('#devlite-overlay-root')?.shadowRoot?.querySelector('.devlite-panel:not([hidden])')", "panel opens");
  await waitForCaptureStart(cdpPort, page, extensionId);
  await setPanelFrame(page);
  console.log("panel capture started");

  const captures = [];
  console.log("capturing text editing");
  captures.push(await captureTextEditingState(page));
  console.log("capturing prompt export");
  captures.push(await capturePromptState(page));
  console.log("preparing diagnostics");
  await prepareDiagnosticEvents(page);
  console.log("capturing network");
  captures.push(await captureNetworkState(page));
  console.log("capturing performance");
  captures.push(await capturePerformanceState(page));
  console.log("capturing logs");
  captures.push(await captureLogState(page));

  for (let index = 0; index < captures.length; index += 1) {
    const shot = featureShots[index];
    await composeScreenshotFile(captures[index], shot, join(outputDir, shot.filename));
    console.log(`wrote ${shot.filename}`);
  }

  const promoSeed = captures[2] || captures[0];
  await composePromoFile(promoSeed, smallPromoSize, "small", join(outputDir, "promo-small-440x280.png"));
  await composePromoFile(promoSeed, marqueeSize, "marquee", join(outputDir, "promo-marquee-1400x560.png"));
  console.log(`Chrome Web Store images written to ${outputDir}`);
} finally {
  await page?.close().catch(() => null);
  await browser?.close().catch(() => null);
  if (chromeProcess && !chromeProcess.killed) chromeProcess.kill("SIGTERM");
  if (demoProcess && !demoProcess.killed) demoProcess.kill("SIGTERM");
  await rm(profileDir, { recursive: true, force: true }).catch(() => null);
  await rm(extensionRoot, { recursive: true, force: true }).catch(() => null);
  await rm(compositionDir, { recursive: true, force: true }).catch(() => null);
}

async function captureTextEditingState(pageSession) {
  await openPanelTab(pageSession, "element");
  await selectElement(pageSession, ".body-copy");
  await shadowClick(pageSession, '[data-style-action="text"]');
  await waitForEval(pageSession, "document.querySelector('.body-copy')?.getAttribute('contenteditable') === 'plaintext-only'", "inline text editor active");
  await evaluate(
    pageSession,
    `
      (() => {
        const target = document.querySelector(".body-copy");
        target.textContent = "选中文字后直接修改，样式和内容都会进入 Prompt。";
        target.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: target.textContent }));
        return true;
      })()
    `
  );
  await delay(300);
  await placeStyleEditor(pageSession, 620, 330);
  return capturePagePng(pageSession);
}

async function capturePromptState(pageSession) {
  await selectElement(pageSession, "#hero-title");
  await applyEditorStyles(pageSession, {
    color: "#214f3d",
    "font-size": "72px"
  });
  await selectElement(pageSession, "#state-button");
  await applyEditorStyles(pageSession, {
    "background-color": "#214f3d",
    color: "#ffffff",
    "border-radius": "10px"
  });
  await shadowClick(pageSession, '[data-style-action="back-panel"]');
  await waitForEval(pageSession, "document.querySelector('#devlite-overlay-root')?.shadowRoot?.querySelectorAll('.style-record').length >= 3", "multiple edit records");
  await setPanelFrame(pageSession);
  await shadowClick(pageSession, 'button[data-action="copy-prompt"]');
  await delay(500);
  return capturePagePng(pageSession);
}

async function prepareDiagnosticEvents(pageSession) {
  await openPanelTab(pageSession, "network");
  await evaluate(
    pageSession,
    `
      (() => {
        for (const id of ["fetch-ok", "fetch-post", "fetch-error", "fetch-slow", "fetch-large", "xhr-ok"]) {
          document.getElementById(id)?.click();
        }
        setTimeout(() => console.log("DevLite demo log: account profile synced", { feature: "log", status: "ok" }), 20);
        setTimeout(() => console.log("DevLite demo log: copied repair prompt", { changes: 3 }), 60);
        setTimeout(() => document.getElementById("console-error")?.click(), 100);
        setTimeout(() => document.getElementById("throw-error")?.click(), 160);
        setTimeout(() => document.getElementById("reject-promise")?.click(), 220);
        setTimeout(() => document.getElementById("long-task")?.click(), 300);
        return true;
      })()
    `
  );
  await delay(3400);
}

async function captureNetworkState(pageSession) {
  await openPanelTab(pageSession, "network");
  await evaluate(pageSession, `document.getElementById("fetch-ok")?.click(); true;`);
  await delay(900);
  await shadowClickText(pageSession, ".network-row", "/api/profile");
  await shadowClick(pageSession, 'button[data-network-detail="response"]');
  await waitForEval(pageSession, "document.querySelector('#devlite-overlay-root')?.shadowRoot?.textContent.includes('Avery Stone')", "network response body visible");
  await setPanelFrame(pageSession);
  return capturePagePng(pageSession);
}

async function capturePerformanceState(pageSession) {
  await openPanelTab(pageSession, "performance");
  await waitForEval(
    pageSession,
    "document.querySelector('#devlite-overlay-root')?.shadowRoot?.textContent.includes('长任务') || document.querySelector('#devlite-overlay-root')?.shadowRoot?.textContent.includes('慢资源')",
    "performance evidence visible"
  );
  await setPanelFrame(pageSession);
  return capturePagePng(pageSession);
}

async function captureLogState(pageSession) {
  await openPanelTab(pageSession, "diagnostics");
  await shadowClick(pageSession, 'button[data-diagnostic-filter="logs"]');
  await waitForEval(pageSession, "document.querySelector('#devlite-overlay-root')?.shadowRoot?.textContent.includes('DevLite demo log')", "console logs visible");
  await setPanelFrame(pageSession);
  return capturePagePng(pageSession);
}

async function selectElement(pageSession, selector) {
  const started = await evaluate(
    pageSession,
    `
      (() => {
        const root = document.querySelector("#devlite-overlay-root")?.shadowRoot;
        const editor = root?.querySelector(".style-editor-popover:not([hidden])");
        if (editor) {
          editor.querySelector('[data-style-action="select"]')?.click();
          return true;
        }
        root?.querySelector('button[data-tab="element"]')?.click();
        root?.querySelector('button[data-action="quick-select"]')?.click();
        return true;
      })()
    `
  );
  assert(started, `could not start element selection for ${selector}`);
  await delay(180);
  await clickCenter(pageSession, selector);
  await waitForEval(pageSession, "!!document.querySelector('#devlite-overlay-root')?.shadowRoot?.querySelector('.style-editor-popover:not([hidden])')", "style editor visible");
}

async function applyEditorStyles(pageSession, styles) {
  await evaluate(
    pageSession,
    `
      (() => {
        const root = document.querySelector("#devlite-overlay-root")?.shadowRoot;
        const editor = root?.querySelector(".style-editor-popover");
        const styles = ${JSON.stringify(styles)};
        for (const [prop, value] of Object.entries(styles)) {
          const input = editor?.querySelector('[data-prop="' + prop + '"]');
          if (!input) continue;
          input.value = value;
          input.dispatchEvent(new Event("input", { bubbles: true }));
        }
        return true;
      })()
    `
  );
  await delay(260);
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
        panel.style.width = "760px";
        panel.style.height = "700px";
        panel.style.top = "18px";
        panel.style.right = "18px";
        panel.style.left = "auto";
        return true;
      })()
    `
  );
}

async function placeStyleEditor(pageSession, left, top) {
  await evaluate(
    pageSession,
    `
      (() => {
        const root = document.querySelector("#devlite-overlay-root")?.shadowRoot;
        const editor = root?.querySelector(".style-editor-popover");
        if (!editor) return false;
        editor.style.left = ${JSON.stringify(`${left}px`)};
        editor.style.top = ${JSON.stringify(`${top}px`)};
        return true;
      })()
    `
  );
}

async function composeScreenshotFile(imageBuffer, shot, outputPath) {
  const html = storeScreenshotHtml(imageBuffer.toString("base64"), shot);
  await renderHtmlToPng(html, screenshotSize, outputPath);
}

async function composePromoFile(imageBuffer, size, variant, outputPath) {
  const icon = await readFile(join(distDir, "icons/devlite-ui-256.png"));
  const html = promoHtml(imageBuffer.toString("base64"), icon.toString("base64"), size, variant);
  await renderHtmlToPng(html, size, outputPath);
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
      "--force-device-scale-factor=1",
      "--virtual-time-budget=1200",
      `--window-size=${size.width},${size.height}`,
      `--screenshot=${outputPath}`,
      pathToFileURL(htmlPath).href
    ],
    { timeout: 30000 }
  );
}

async function capturePagePng(session) {
  await delay(200);
  const screenshot = await session.send("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
    captureBeyondViewport: false
  });
  return Buffer.from(screenshot.data, "base64");
}

function storeScreenshotHtml(base64, shot) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <style>
    * { box-sizing: border-box; }
    html, body { width: 1280px; height: 800px; margin: 0; overflow: hidden; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif;
      color: #141413;
      background: #f8f5ee;
    }
    .shot { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
    .scrim {
      position: absolute;
      inset: 0;
      background:
        linear-gradient(90deg, rgba(20, 20, 19, .72) 0%, rgba(20, 20, 19, .28) 28%, rgba(20, 20, 19, 0) 58%),
        linear-gradient(180deg, rgba(20, 20, 19, .18) 0%, rgba(20, 20, 19, 0) 34%);
      pointer-events: none;
    }
    .label {
      position: absolute;
      left: 34px;
      top: 30px;
      width: 392px;
      padding: 22px 24px 24px;
      border: 1px solid rgba(255,255,255,.22);
      border-radius: 8px;
      background: rgba(20,20,19,.76);
      color: #fffaf3;
      box-shadow: 0 24px 70px rgba(0,0,0,.22);
      backdrop-filter: blur(14px);
    }
    .label span {
      display: inline-flex;
      height: 28px;
      align-items: center;
      padding: 0 10px;
      border-radius: 6px;
      background: #d97757;
      color: #fff;
      font-size: 13px;
      font-weight: 760;
    }
    .label strong {
      display: block;
      margin-top: 14px;
      font-size: 33px;
      line-height: 1.08;
      letter-spacing: 0;
    }
    .label p {
      margin: 12px 0 0;
      color: rgba(255,250,243,.78);
      font-size: 16px;
      line-height: 1.48;
    }
  </style>
</head>
<body>
  <img class="shot" src="data:image/png;base64,${base64}" alt="" />
  <div class="scrim"></div>
  <section class="label">
    <span>${escapeHtml(shot.label)}</span>
    <strong>${escapeHtml(shot.title)}</strong>
    <p>${escapeHtml(shot.caption)}</p>
  </section>
  <script>
    Promise.all(Array.from(document.images).map((img) => img.complete ? true : new Promise((resolve) => {
      img.addEventListener("load", resolve, { once: true });
      img.addEventListener("error", resolve, { once: true });
    }))).then(() => { window.__ready = true; });
  </script>
</body>
</html>`;
}

function promoHtml(shotBase64, iconBase64, size, variant) {
  const isSmall = variant === "small";
  const titleSize = isSmall ? 42 : 86;
  const logoSize = isSmall ? 62 : 118;
  const contentLeft = isSmall ? 30 : 94;
  const cardWidth = isSmall ? 240 : 590;
  const cardHeight = isSmall ? 150 : 330;
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <style>
    * { box-sizing: border-box; }
    html, body { width: ${size.width}px; height: ${size.height}px; margin: 0; overflow: hidden; }
    body {
      position: relative;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif;
      background:
        radial-gradient(circle at 82% 22%, rgba(217, 119, 87, .26), transparent 28%),
        linear-gradient(135deg, #141413 0%, #28231d 58%, #f3ded4 58%, #f6efe7 100%);
      color: #fffaf3;
    }
    .brand {
      position: absolute;
      left: ${contentLeft}px;
      top: ${isSmall ? 44 : 98}px;
      display: flex;
      align-items: center;
      gap: ${isSmall ? 14 : 28}px;
    }
    .brand img {
      width: ${logoSize}px;
      height: ${logoSize}px;
      border-radius: 16px;
      box-shadow: 0 26px 60px rgba(0,0,0,.28);
    }
    .brand strong {
      display: block;
      font-size: ${titleSize}px;
      line-height: .94;
      letter-spacing: 0;
    }
    .brand span {
      display: block;
      margin-top: ${isSmall ? 7 : 14}px;
      max-width: ${isSmall ? 300 : 470}px;
      color: rgba(255,250,243,.78);
      font-size: ${isSmall ? 13 : 25}px;
      font-weight: 650;
      line-height: 1.24;
    }
    .product-card {
      position: absolute;
      right: ${isSmall ? -46 : 98}px;
      bottom: ${isSmall ? -18 : 52}px;
      width: ${cardWidth}px;
      height: ${cardHeight}px;
      overflow: hidden;
      border: 1px solid rgba(255,255,255,.42);
      border-radius: 8px;
      background: #fffaf3;
      box-shadow: 0 30px 90px rgba(0,0,0,.34);
      transform: rotate(${isSmall ? "-5deg" : "-3deg"});
    }
    .product-card img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      object-position: 72% 50%;
    }
    .line {
      position: absolute;
      left: ${contentLeft}px;
      bottom: ${isSmall ? 34 : 76}px;
      width: ${isSmall ? 150 : 420}px;
      height: ${isSmall ? 5 : 8}px;
      border-radius: 999px;
      background: #d97757;
    }
  </style>
</head>
<body>
  <div class="brand">
    <img src="data:image/png;base64,${iconBase64}" alt="" />
    <div>
      <strong>DevLite</strong>
      <span>${isSmall ? "直接改页面，复制 Prompt<br />给 Agent" : "直接修改页面元素，一键生成 Agent 修复 Prompt"}</span>
    </div>
  </div>
  <div class="line"></div>
  <div class="product-card"><img src="data:image/png;base64,${shotBase64}" alt="" /></div>
  <script>
    Promise.all(Array.from(document.images).map((img) => img.complete ? true : new Promise((resolve) => {
      img.addEventListener("load", resolve, { once: true });
      img.addEventListener("error", resolve, { once: true });
    }))).then(() => { window.__ready = true; });
  </script>
</body>
</html>`;
}

async function setExtensionDefaults(browserSession, port, extensionId) {
  const targetId = await browserSession.createTarget(`chrome-extension://${extensionId}/options.html`);
  const target = await waitForTarget(port, (item) => item.id === targetId, "extension options target", 10000);
  const extensionPage = await CdpSession.connect(target.webSocketDebuggerUrl);
  try {
    await extensionPage.send("Runtime.enable");
    await waitForEval(extensionPage, "document.readyState === 'complete'", "extension options ready", 10000);
    await evaluate(
      extensionPage,
      `
        chrome.storage.local.set({
          "devlite.settings": {
            locale: "zh",
            uiTheme: "claude",
            collectResponseBody: true,
            maxResponseLength: 6000,
            slowRequestThreshold: 1200,
            retainHours: 24,
            extraRedactionKeys: []
          }
        })
      `
    );
  } finally {
    await extensionPage.close().catch(() => null);
    await browserSession.send("Target.closeTarget", { targetId }).catch(() => null);
  }
}

async function getBackgroundSession(port, extensionId) {
  const target = await waitForTarget(
    port,
    (item) => item.type === "service_worker" && item.url.startsWith(`chrome-extension://${extensionId}/`),
    "extension service worker",
    10000
  );
  const worker = await CdpSession.connect(target.webSocketDebuggerUrl);
  await worker.send("Runtime.enable");
  return worker;
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

async function clickCenter(session, selector) {
  const point = await elementCenter(session, selector);
  await mouseClick(session, point.x, point.y, 1);
}

async function elementCenter(session, selector) {
  const point = await evaluate(
    session,
    `
      (() => {
        const node = document.querySelector(${JSON.stringify(selector)});
        if (!node) return null;
        const previousScrollBehavior = document.documentElement.style.scrollBehavior;
        document.documentElement.style.scrollBehavior = "auto";
        node.scrollIntoView({ block: "center", inline: "center" });
        document.documentElement.style.scrollBehavior = previousScrollBehavior;
        const rect = node.getBoundingClientRect();
        return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
      })()
    `
  );
  assert(point, `element not found: ${selector}`);
  return point;
}

async function mouseClick(session, x, y, clickCount) {
  await session.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  await session.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount });
  await session.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount });
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

async function ensureLauncher(pageSession, pageUrl) {
  const hasLauncher = "!!document.querySelector('#devlite-overlay-root')?.shadowRoot?.querySelector('.devlite-dock')";
  const autoInjected = await waitForEval(pageSession, hasLauncher, "DevLite launcher auto injection", 3000).then(
    () => true,
    () => false
  );
  if (autoInjected) return;
  await pageSession.send("Page.reload", { ignoreCache: true });
  await waitForEval(
    pageSession,
    `location.href.startsWith(${JSON.stringify(pageUrl)}) && document.readyState === "complete"`,
    "demo page reloads after extension startup",
    10000
  );
  await waitForEval(pageSession, hasLauncher, "DevLite launcher exists after reload", 10000);
}

async function waitForCaptureStart(port, pageSession, extensionId) {
  const started = await waitFor(
    async () => {
      const state = await readBackgroundCaptureState(port, extensionId);
      return state?.sessionActive ? state : null;
    },
    "background capture session starts",
    8000
  ).then(
    () => true,
    () => false
  );
  if (started) return;

  const panel = await evaluate(
    pageSession,
    `
      (() => {
        const root = document.querySelector("#devlite-overlay-root")?.shadowRoot;
        return root?.textContent?.replace(/\\s+/g, " ").trim().slice(0, 600) || "";
      })()
    `
  ).catch((error) => String(error));
  throw new Error(`capture did not start: ${panel}`);
}

async function readBackgroundCaptureState(port, extensionId) {
  const worker = await getBackgroundSession(port, extensionId).catch(() => null);
  if (!worker) return null;
  try {
    return await evaluate(
      worker,
      `
        (async () => {
          const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
          const tab = tabs[0] || null;
          const storage = chrome.storage.session || chrome.storage.local;
          const data = await storage.get("devlite:sessions");
          const session = tab?.id ? data["devlite:sessions"]?.[String(tab.id)] || null : null;
          return {
            tab: tab ? { id: tab.id, url: tab.url, title: tab.title } : null,
            sessionActive: session?.active === true,
            session
          };
        })()
      `
    );
  } finally {
    await worker.close().catch(() => null);
  }
}

async function waitForExtensionId(session, profileDir, extensionDir) {
  try {
    return await waitFor(async () => {
      const extensionId = findExtensionIdFromProfile(profileDir, extensionDir) || (await findExtensionId(session));
      return extensionId || null;
    }, "DevLite extension registration", 10000);
  } catch (error) {
    const result = await session.send("Target.getTargets").catch(() => ({ targetInfos: [] }));
    const profileExtensions = listProfileExtensions(profileDir);
    console.error(
      `[chrome-targets] ${JSON.stringify(
        result.targetInfos.map((target) => ({ type: target.type, url: target.url, title: target.title })),
        null,
        2
      )}`
    );
    console.error(`[profile-extensions] ${JSON.stringify(profileExtensions, null, 2)}`);
    throw error;
  }
}

async function findExtensionId(session) {
  const result = await session.send("Target.getTargets");
  const target = result.targetInfos.find(
    (item) => item.type === "service_worker" && /chrome-extension:\/\/[^/]+\/background\.js$/.test(item.url)
  ) ?? result.targetInfos.find((item) => /chrome-extension:\/\/[^/]+\/options\.html$/.test(item.url));
  return target?.url.match(/^chrome-extension:\/\/([^/]+)\//)?.[1] || "";
}

function findExtensionIdFromProfile(profileDir, extensionDir) {
  const preferencesPath = join(profileDir, "Default", "Preferences");
  if (!existsSync(preferencesPath)) return "";
  try {
    const preferences = JSON.parse(readFileSync(preferencesPath, "utf8"));
    const settings = preferences.extensions?.settings ?? {};
    const expectedPath = resolve(extensionDir);
    for (const [id, extension] of Object.entries(settings)) {
      if (
        extension &&
        typeof extension === "object" &&
        resolve(String(extension.path ?? "")) === expectedPath &&
        extension.manifest?.name === "DevLite"
      ) {
        return id;
      }
    }
  } catch {
    return "";
  }
  return "";
}

function listProfileExtensions(profileDir) {
  const preferencesPath = join(profileDir, "Default", "Preferences");
  if (!existsSync(preferencesPath)) return [];
  try {
    const preferences = JSON.parse(readFileSync(preferencesPath, "utf8"));
    const settings = preferences.extensions?.settings ?? {};
    return Object.entries(settings).map(([id, extension]) => ({
      id,
      name: extension?.manifest?.name,
      path: extension?.path,
      state: extension?.state
    }));
  } catch {
    return [];
  }
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
