import { spawn } from "node:child_process";
import { execFileSync } from "node:child_process";
import { createServer } from "node:net";
import { cp, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const distDir = join(root, "dist");
const demoDir = join(root, "demo/devlite-qa");
const artifactsDir = "/tmp/devlite-qa";
const chromePath = findChromeExecutable();
const replacementImagePath = join(artifactsDir, "replacement-image.svg");

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
      this.pending.set(id, { resolve, reject });
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

await mkdir(artifactsDir, { recursive: true });
await writeFile(
  replacementImagePath,
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 400">
  <rect width="640" height="400" fill="#ffe7d1"/>
  <path d="M84 308c70-104 154-156 252-156s170 52 220 156" fill="#d97757"/>
  <circle cx="320" cy="142" r="76" fill="#b3261e"/>
  <text x="320" y="350" text-anchor="middle" fill="#141413" font-family="Arial, sans-serif" font-size="30" font-weight="700">Replaced by QA</text>
</svg>`
);

const demoPort = await freePort();
const cdpPort = await freePort();
const profileDir = await mkdtemp(join(tmpdir(), "devlite-chrome-"));
const extensionRoot = await mkdtemp(join(tmpdir(), "devlite-extension-"));
const extensionDir = join(extensionRoot, "extension");
const demoUrl = `http://127.0.0.1:${demoPort}`;
const results = [];
let demoProcess;
let chromeProcess;
let browser;
let page;
let extensionPage;

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
  record("demo server starts", true, demoUrl);

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
      "--window-size=1440,1000",
      "about:blank"
    ],
    { stdio: ["ignore", "pipe", "pipe"] }
  );
  chromeProcess.stdout.on("data", (chunk) => process.stdout.write(`[chrome] ${chunk}`));
  chromeProcess.stderr.on("data", (chunk) => process.stderr.write(`[chrome] ${chunk}`));

  await waitForHttp(`http://127.0.0.1:${cdpPort}/json/version`, "Chrome DevTools");
  browser = await CdpSession.fromVersion(cdpPort);
  const extensionId = await waitForExtensionId(browser);
  record("extension loads in temporary Chrome profile", true, extensionId);
  const targetId = await browser.createTarget(demoUrl);
  const target = await waitForTarget(cdpPort, (item) => item.id === targetId, "demo page target");
  page = await CdpSession.connect(target.webSocketDebuggerUrl);
  await page.send("Runtime.enable");
  await page.send("Page.enable");
  await page.send("DOM.enable");
  await waitForEval(page, "document.readyState === 'complete'", "demo page loaded");

  await waitForEval(page, "!!document.querySelector('#devlite-overlay-root')?.shadowRoot?.querySelector('.devlite-dock')", "DevLite launcher exists");
  record("right-side launcher exists on local service page", true);

  await shadowClick(page, ".devlite-launcher");
  await waitForEval(page, "!!document.querySelector('#devlite-overlay-root')?.shadowRoot?.querySelector('.devlite-panel:not([hidden])')", "panel opens");
  await waitForEval(page, "document.querySelector('#devlite-overlay-root')?.shadowRoot?.textContent.includes('采集中')", "capture starts");
  record("panel opens and starts page capture", true);

  await shadowClick(page, ".locale-button");
  await waitForEval(page, "document.querySelector('#devlite-overlay-root')?.shadowRoot?.textContent.includes('Performance')", "English locale applied");
  record("content panel switches to English", true);
  await shadowClick(page, ".locale-button");
  await waitForEval(page, "document.querySelector('#devlite-overlay-root')?.shadowRoot?.textContent.includes('性能诊断')", "Chinese locale restored");
  record("content panel switches back to Chinese", true);

  await shadowClick(page, 'button[data-action="show-settings"]');
  await waitForEval(page, "document.querySelector('#devlite-overlay-root')?.shadowRoot?.textContent.includes('诊断配置')", "settings tab visible");
  record("content panel settings tab opens", true);

  await evaluate(page, `
    (() => {
      for (const id of ["fetch-ok", "fetch-post", "fetch-error", "fetch-slow", "fetch-large", "xhr-ok"]) {
        document.getElementById(id).click();
      }
      setTimeout(() => document.getElementById("console-error").click(), 10);
      setTimeout(() => document.getElementById("throw-error").click(), 20);
      setTimeout(() => document.getElementById("reject-promise").click(), 40);
      setTimeout(() => document.getElementById("long-task").click(), 80);
      return true;
    })()
  `);
  await delay(3000);

  await shadowClick(page, 'button[data-tab="network"]');
  await waitForEval(page, "document.querySelector('#devlite-overlay-root')?.shadowRoot?.querySelectorAll('.network-row').length >= 6", "network rows captured");
  record("network panel captures fetch and XHR rows", true);

  await evaluate(page, `document.getElementById("fetch-ok").click(); true;`);
  await delay(800);
  await shadowClick(page, 'button[data-tab="network"]');
  await shadowClickText(page, ".network-row", "/api/profile");
  await waitForEval(page, "document.querySelector('#devlite-overlay-root')?.shadowRoot?.textContent.includes('Avery Stone')", "response preview contains JSON body");
  await shadowClick(page, 'button[data-network-detail="response"]');
  await waitForEval(page, "document.querySelector('#devlite-overlay-root')?.shadowRoot?.textContent.includes('Avery Stone')", "response tab contains body");
  await shadowClick(page, 'button[data-action="copy-selected-network"]');
  const copiedNetwork = readClipboard();
  assert(copiedNetwork.includes("GET") && copiedNetwork.includes("/api/profile") && copiedNetwork.includes("Avery Stone"), "selected GET request copies response JSON");
  await shadowClickText(page, ".network-row", "/api/save");
  await shadowClick(page, 'button[data-network-detail="request"]');
  await waitForEval(page, "document.querySelector('#devlite-overlay-root')?.shadowRoot?.textContent.includes('Draft QA record')", "request tab contains POST body");
  await shadowClick(page, 'button[data-network-detail="headers"]');
  await waitForEval(page, "document.querySelector('#devlite-overlay-root')?.shadowRoot?.textContent.includes('Response headers')", "headers tab visible");
  record("network detail tabs and selected request copy work", true);

  await shadowClick(page, 'button[data-tab="diagnostics"]');
  await waitForEval(page, "document.querySelector('#devlite-overlay-root')?.shadowRoot?.textContent.includes('Demo console.error')", "console.error visible");
  await waitForEval(page, "document.querySelector('#devlite-overlay-root')?.shadowRoot?.textContent.includes('Demo JS error')", "JS error visible");
  await waitForEval(page, "document.querySelector('#devlite-overlay-root')?.shadowRoot?.textContent.includes('Demo unhandled rejection')", "promise rejection visible");
  record("diagnostics panel shows console JS and Promise failures", true);

  await shadowClick(page, 'button[data-tab="performance"]');
  await waitForEval(page, "document.querySelector('#devlite-overlay-root')?.shadowRoot?.textContent.includes('DOMContentLoaded')", "performance metrics visible");
  await waitForEval(page, "document.querySelector('#devlite-overlay-root')?.shadowRoot?.textContent.includes('长任务') || document.querySelector('#devlite-overlay-root')?.shadowRoot?.textContent.includes('资源')", "performance evidence visible");
  await shadowClick(page, 'button[data-action="copy-performance-prompt"]');
  const performancePrompt = readClipboard();
  assert(performancePrompt.includes("性能诊断") || performancePrompt.includes("performance"), "performance prompt copied");
  record("performance prompt copies structured data", true);

  await shadowClick(page, 'button[data-tab="element"]');
  await shadowClick(page, 'button[data-action="quick-select"]');
  await clickCenter(page, '[data-testid="editable-card"]');
  await waitForEval(page, "!!document.querySelector('#devlite-overlay-root')?.shadowRoot?.querySelector('.style-editor-popover:not([hidden])')", "style editor appears");
  await evaluate(page, `
    (() => {
      const shadow = document.querySelector("#devlite-overlay-root").shadowRoot;
      const color = shadow.querySelector('.style-editor-popover [data-prop="color"]');
      const fontSize = shadow.querySelector('.style-editor-popover [data-prop="font-size"]');
      color.value = "#b3261e";
      color.dispatchEvent(new Event("input", { bubbles: true }));
      fontSize.value = "23px";
      fontSize.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    })()
  `);
  await waitForEval(page, "document.querySelector('[data-testid=\"editable-card\"]').style.color === 'rgb(179, 38, 30)' || document.querySelector('[data-testid=\"editable-card\"]').style.color === '#b3261e'", "style edit applied");
  record("style editor applies CSS changes", true);

  await doubleClickCenter(page, ".body-copy");
  await waitForEval(page, "document.querySelector('.body-copy')?.getAttribute('contenteditable') === 'plaintext-only'", "inline text editing starts");
  await evaluate(page, `
    (() => {
      const target = document.querySelector(".body-copy");
      target.textContent = "Updated by DevLite QA prompt export.";
      target.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: "Updated by DevLite QA prompt export." }));
      return target.textContent;
    })()
  `);
  await waitForEval(page, "document.querySelector('.body-copy')?.textContent.includes('Updated by DevLite QA')", "inline text edit recorded");
  record("double-click inline text editing works", true);

  await shadowClick(page, ".devlite-launcher");
  await waitForEval(page, "!!document.querySelector('#devlite-overlay-root')?.shadowRoot?.querySelector('.devlite-panel:not([hidden])')", "panel reopens after inline edit");
  await shadowClick(page, 'button[data-tab="element"]');
  await shadowClick(page, 'button[data-action="quick-select"]');
  await clickCenter(page, '[data-testid="replaceable-image"]');
  await waitForEval(page, "!!document.querySelector('#devlite-overlay-root')?.shadowRoot?.querySelector('.style-editor-popover:not([hidden])')", "style editor appears for image");
  await page.send("Page.setInterceptFileChooserDialog", { enabled: true });
  const fileChooser = page.waitForEvent("Page.fileChooserOpened", (params) => Boolean(params.backendNodeId), 5000);
  await shadowClick(page, '[data-style-action="replace-image"]');
  const fileChooserEvent = await fileChooser;
  await page.send("DOM.setFileInputFiles", { files: [replacementImagePath], backendNodeId: fileChooserEvent.backendNodeId });
  await page.send("Page.setInterceptFileChooserDialog", { enabled: false });
  await waitForEval(page, "document.querySelector('[data-testid=\"replaceable-image\"]')?.src.startsWith('data:image/svg+xml')", "image source replaced");
  record("image replacement applies selected file", true);

  await shadowClick(page, ".devlite-launcher");
  await waitForEval(page, "!!document.querySelector('#devlite-overlay-root')?.shadowRoot?.querySelector('.devlite-panel:not([hidden])')", "panel reopens after image replacement");
  await shadowClick(page, 'button[data-tab="element"]');
  await shadowClick(page, 'button[data-action="copy-prompt"]');
  await delay(300);
  const editPrompt = readClipboard();
  const parsedPrompt = JSON.parse(editPrompt);
  assert(Array.isArray(parsedPrompt.changes) && parsedPrompt.changes.length >= 3, "edit prompt contains multiple selected changes");
  assert(editPrompt.includes("Updated by DevLite QA prompt export"), "edit prompt contains text change");
  assert(editPrompt.includes("font-size") || editPrompt.includes("color"), "edit prompt contains style change");
  assert(editPrompt.includes("inline image data") || editPrompt.includes("Replaced by QA") || editPrompt.includes("替换图片"), "edit prompt contains image replacement");
  await writeFile(join(artifactsDir, "edit-prompt.json"), editPrompt);
  record("full edit prompt copies multiple modifications as structured JSON", true, join(artifactsDir, "edit-prompt.json"));

  const popupTargetId = await browser.createTarget(`chrome-extension://${extensionId}/popup.html`);
  const popupTarget = await waitForTarget(cdpPort, (item) => item.id === popupTargetId, "popup target");
  extensionPage = await CdpSession.connect(popupTarget.webSocketDebuggerUrl);
  await extensionPage.send("Runtime.enable");
  await waitForEval(extensionPage, "document.body.innerText.includes('DevLite')", "popup renders");
  record("popup page renders with current session state", true);
  await browser.send("Target.activateTarget", { targetId });
  const reportResponse = await evaluate(extensionPage, `
    new Promise((resolve) => chrome.runtime.sendMessage({ type: "generate-report" }, resolve))
  `);
  assert(reportResponse?.ok, "report generation succeeds");
  assert(reportResponse.report.includes("DevLite 页面诊断报告") || reportResponse.report.includes("DevLite Page Diagnostics Report"), "report has title");
  await writeFile(join(artifactsDir, "report.md"), reportResponse.report);
  record("background report generation works", true, join(artifactsDir, "report.md"));

  const markdownExport = await evaluate(extensionPage, `
    new Promise((resolve) => chrome.runtime.sendMessage({ type: "generate-export", format: "markdown" }, resolve))
  `);
  assert(markdownExport?.ok && markdownExport.text.includes("DevLite"), "markdown export succeeds");
  const jsonExport = await evaluate(extensionPage, `
    new Promise((resolve) => chrome.runtime.sendMessage({ type: "generate-export", format: "json" }, resolve))
  `);
  const jsonSession = JSON.parse(jsonExport.text);
  assert(jsonExport?.ok && Array.isArray(jsonSession.events) && Array.isArray(jsonSession.styleChanges), "json export succeeds");
  const promptExport = await evaluate(extensionPage, `
    new Promise((resolve) => chrome.runtime.sendMessage({ type: "generate-export", format: "prompt" }, resolve))
  `);
  assert(promptExport?.ok && promptExport.text.includes("changes") && promptExport.text.includes("Updated by DevLite QA prompt export") && promptExport.text.includes("inline image data"), "repair prompt export succeeds");
  record("popup/runtime exports markdown json and repair prompt", true);

  const stopResponse = await evaluate(extensionPage, `
    new Promise((resolve) => chrome.runtime.sendMessage({ type: "stop-diagnosis" }, resolve))
  `);
  assert(stopResponse?.ok, "stop diagnosis succeeds");
  await waitForEval(page, "document.querySelector('#devlite-overlay-root')?.shadowRoot?.textContent.includes('待采集')", "content panel shows stopped state");
  record("stop diagnosis updates content panel state", true);

  await writeFile(join(artifactsDir, "browser-results.json"), JSON.stringify({ demoUrl, results }, null, 2));
  console.log(`QA artifacts written to ${artifactsDir}`);
  console.log(JSON.stringify({ ok: true, results }, null, 2));
} catch (error) {
  record("qa run failed", false, error instanceof Error ? error.message : String(error));
  await mkdir(artifactsDir, { recursive: true });
  await writeFile(join(artifactsDir, "browser-results.json"), JSON.stringify({ demoUrl, results }, null, 2));
  throw error;
} finally {
  await extensionPage?.close().catch(() => null);
  await page?.close().catch(() => null);
  await browser?.close().catch(() => null);
  if (chromeProcess && !chromeProcess.killed) chromeProcess.kill("SIGTERM");
  if (demoProcess && !demoProcess.killed) demoProcess.kill("SIGTERM");
  await rm(profileDir, { recursive: true, force: true }).catch(() => null);
  await rm(extensionRoot, { recursive: true, force: true }).catch(() => null);
}

function record(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` - ${detail}` : ""}`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function readClipboard() {
  return execFileSync("pbpaste", { encoding: "utf8" });
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
  await delay(120);
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
  await delay(120);
}

async function clickCenter(session, selector) {
  const point = await elementCenter(session, selector);
  await mouseClick(session, point.x, point.y, 1);
}

async function doubleClickCenter(session, selector) {
  const point = await elementCenter(session, selector);
  await mouseClick(session, point.x, point.y, 1);
  await delay(60);
  await mouseClick(session, point.x, point.y, 2);
}

async function elementCenter(session, selector) {
  const point = await evaluate(
    session,
    `
      (() => {
        const node = document.querySelector(${JSON.stringify(selector)});
        if (!node) return null;
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

async function findExtensionId(session) {
  const result = await session.send("Target.getTargets");
  const target = result.targetInfos.find((item) => /chrome-extension:\/\/[^/]+\/(?:background|popup|options)\.js|chrome-extension:\/\/[^/]+\/background\.js/.test(item.url));
  return target?.url.match(/^chrome-extension:\/\/([^/]+)\//)?.[1] || "";
}

async function waitForExtensionId(session) {
  try {
    return await waitFor(async () => {
      const extensionId = await findExtensionId(session);
      return extensionId || null;
    }, "extension service worker target", 10000);
  } catch (error) {
    const result = await session.send("Target.getTargets").catch(() => ({ targetInfos: [] }));
    console.error(
      `[chrome-targets] ${JSON.stringify(
        result.targetInfos.map((target) => ({ type: target.type, url: target.url, title: target.title })),
        null,
        2
      )}`
    );
    throw error;
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

function findChromeExecutable() {
  const candidates = [
    process.env.CHROME_BIN,
    ...findChromeForTestingExecutables("/tmp/devlite-browsers/chrome"),
    "/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  ];
  return candidates.find((path) => path && existsSync(path));
}

function findChromeForTestingExecutables(baseDir) {
  if (!existsSync(baseDir)) return [];
  const candidates = [];
  for (const buildDir of safeReadDir(baseDir)) {
    const buildPath = join(baseDir, buildDir);
    candidates.push(
      join(buildPath, "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"),
      join(buildPath, "chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing")
    );
  }
  return candidates;
}

function safeReadDir(path) {
  try {
    return readdirSync(path);
  } catch {
    return [];
  }
}
