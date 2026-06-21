import { execFile, execFileSync, spawn } from "node:child_process";
import { createServer } from "node:net";
import { cp, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { deflateSync } from "node:zlib";

const root = resolve(import.meta.dirname, "..");
const distDir = join(root, "dist");
const demoDir = join(root, "demo/devlite-qa");
const artifactsDir = join(tmpdir(), "devlite-qa");
const chromeCacheDir = join(tmpdir(), "devlite-browsers/chrome");
const execFileAsync = promisify(execFile);
const chromePath = await findChromeExecutable();
const replacementRasterPath = join(artifactsDir, "replacement-crop.png");

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
await writeFile(replacementRasterPath, pngFixtureBuffer(640, 400));

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
      demoUrl
    ],
    { stdio: ["ignore", "pipe", "pipe"] }
  );
  chromeProcess.stdout.on("data", (chunk) => process.stdout.write(`[chrome] ${chunk}`));
  chromeProcess.stderr.on("data", (chunk) => process.stderr.write(`[chrome] ${chunk}`));

  await waitForHttp(`http://127.0.0.1:${cdpPort}/json/version`, "Chrome DevTools");
  browser = await CdpSession.fromVersion(cdpPort);
  const extensionId = await waitForExtensionId(browser, cdpPort, profileDir, extensionDir);
  record("extension loads in temporary Chrome profile", true, extensionId);
  const target = await waitForTarget(cdpPort, (item) => item.type === "page" && item.url.startsWith(demoUrl), "demo page target");
  page = await CdpSession.connect(target.webSocketDebuggerUrl);
  await page.send("Runtime.enable");
  await page.send("Page.enable");
  await page.send("DOM.enable");
  await waitForEval(page, "document.readyState === 'complete'", "demo page loaded");

  await ensureLauncher(page, demoUrl);
  record("right-side launcher exists on local service page", true);

  await shadowClick(page, ".devlite-launcher");
  await waitForEval(page, "!!document.querySelector('#devlite-overlay-root')?.shadowRoot?.querySelector('.devlite-panel:not([hidden])')", "panel opens");
  await waitForEval(
    page,
    "document.querySelector('#devlite-overlay-root')?.shadowRoot?.querySelector('.open-source-link')?.dataset.action === 'show-skill-install'",
    "companion skill entry renders"
  );
  await waitForCaptureStart(cdpPort, page, extensionId);
  record("panel opens and starts page capture", true);
  record("panel shows companion skill entry", true);

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
  await waitForEval(page, "document.querySelector('#devlite-overlay-root')?.shadowRoot?.textContent.includes('FPS')", "performance metrics visible");
  await waitForEval(page, "document.querySelector('#devlite-overlay-root')?.shadowRoot?.textContent.includes('长任务') || document.querySelector('#devlite-overlay-root')?.shadowRoot?.textContent.includes('资源')", "performance evidence visible");
  await shadowClick(page, 'button[data-action="copy-performance-prompt"]');
  const performancePrompt = readClipboard();
  assert(performancePrompt.includes("性能诊断") || performancePrompt.includes("performance"), "performance prompt copied");
  record("performance prompt copies structured data", true);

  await shadowClick(page, 'button[data-tab="element"]');
  await shadowClick(page, 'button[data-action="quick-select"]');
  await clickRelative(page, '[data-testid="editable-card"]', 0.88, 0.12);
  await waitForEval(page, "!!document.querySelector('#devlite-overlay-root')?.shadowRoot?.querySelector('.style-editor-popover:not([hidden])')", "style editor appears");
  await waitForEval(
    page,
    `
      (() => {
        const root = document.querySelector('#devlite-overlay-root')?.shadowRoot;
        const select = root?.querySelector('.style-editor-head-actions [data-style-action="select"].primary');
        const back = root?.querySelector('.style-editor-head-actions [data-style-action="back-panel"]');
        const actions = Array.from(root?.querySelectorAll('.style-editor-actions [data-style-action]') ?? []).map((button) => button.dataset.styleAction);
        if (!select || !back) return false;
        const selectRect = select.getBoundingClientRect();
        const backRect = back.getBoundingClientRect();
        return selectRect.right <= backRect.left && actions.join('|') === 'text|replace-image|replace-icon|delete-element|copy-element|undo';
      })()
    `,
    "style editor action layout matches requested order"
  );
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
  await waitForStyleEditApplied(page);
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
  await page.send("DOM.setFileInputFiles", { files: [replacementRasterPath], backendNodeId: fileChooserEvent.backendNodeId });
  await page.send("Page.setInterceptFileChooserDialog", { enabled: false });
  await waitForEval(page, "!!document.querySelector('#devlite-overlay-root')?.shadowRoot?.querySelector('.image-cropper-modal cropper-canvas')", "image cropper opens");
  await waitForEval(page, cropperSelectionReadyExpression(), "image cropper selection is ready").catch(async (error) => {
    const diagnostics = await evaluate(page, cropperDiagnosticsExpression()).catch((diagnosticError) => ({
      diagnosticError: diagnosticError instanceof Error ? diagnosticError.message : String(diagnosticError)
    }));
    throw new Error(`${error.message}: ${JSON.stringify(diagnostics, null, 2)}`);
  });
  await shadowClick(page, 'button[data-cropper-action="zoom-in"]');
  await shadowClick(page, 'button[data-cropper-action="free-ratio"]');
  await shadowClick(page, 'button[data-cropper-action="reset"]');
  await shadowClick(page, 'button[data-cropper-action="apply"]');
  await waitForEval(page, "document.querySelector('[data-testid=\"replaceable-image\"]')?.src.startsWith('data:image/png')", "cropped image source replaced");
  record("image cropper edits and applies selected raster file", true);

  await shadowClick(page, '[data-style-action="back-panel"]');
  await waitForEval(page, "!!document.querySelector('#devlite-overlay-root')?.shadowRoot?.querySelector('.devlite-panel:not([hidden])')", "panel opens from style editor");
  await shadowClick(page, 'button[data-action="quick-select"]');
  await clickCenter(page, ".muted-panel h3");
  await waitForEval(page, "!!document.querySelector('#devlite-overlay-root')?.shadowRoot?.querySelector('.style-editor-popover:not([hidden])')", "style editor appears for removable element");
  await shadowClick(page, '[data-style-action="delete-element"]');
  await waitForEval(page, "!document.querySelector('.muted-panel h3')", "selected element is deleted");
  record("style editor records element deletion", true);

  await shadowClick(page, ".devlite-launcher");
  await waitForEval(page, "!!document.querySelector('#devlite-overlay-root')?.shadowRoot?.querySelector('.devlite-panel:not([hidden])')", "panel reopens after image replacement");
  await shadowClick(page, 'button[data-tab="element"]');
  await shadowClick(page, 'button[data-action="copy-prompt"]');
  await delay(300);
  const editPrompt = readClipboard();
  const parsedPrompt = JSON.parse(editPrompt);
  assert(Array.isArray(parsedPrompt.changes) && parsedPrompt.changes.length >= 4, "edit prompt contains multiple selected changes");
  assert(editPrompt.includes("Updated by DevLite QA prompt export"), "edit prompt contains text change");
  assert(editPrompt.includes("font-size") || editPrompt.includes("color"), "edit prompt contains style change");
  const deletionModification = parsedPrompt.changes
    .flatMap((change) => change.modifications ?? [])
    .find((modification) => modification.type === "dom" && String(modification.property ?? "").includes("删除"));
  assert(deletionModification?.after === "", "edit prompt contains element deletion DOM modification");
  const imageCropModification = parsedPrompt.changes
    .flatMap((change) => change.modifications ?? [])
    .find((modification) => modification.type === "image" && modification.property === "cropReplacement");
  assert(imageCropModification?.uploadedFile?.name === "replacement-crop.png", "edit prompt contains uploaded image metadata");
  assert(imageCropModification?.source?.name === "replacement-crop.png", "edit prompt preserves image crop metadata compatibility");
  assert(imageCropModification?.originalResource?.value?.includes("images.unsplash.com"), "edit prompt includes original page image resource");
  assert(imageCropModification?.output?.type === "image/png", "edit prompt records crop output type");
  assert((imageCropModification?.assetLookupHints ?? []).includes("replacement-crop.png"), "edit prompt includes local asset lookup hints");
  assert(String(imageCropModification?.instruction ?? "").includes("本地项目"), "edit prompt instructs local project asset lookup");
  assert(editPrompt.includes("[inline image data]"), "edit prompt redacts inline image data");
  assert(!/data:image\/png;base64/i.test(editPrompt), "edit prompt omits cropped image base64");
  await writeFile(join(artifactsDir, "edit-prompt.json"), editPrompt);
  record("full edit prompt copies multiple modifications as structured JSON", true, join(artifactsDir, "edit-prompt.json"));

  await waitForSessionState(
    cdpPort,
    extensionId,
    (session) => (session?.styleChanges ?? []).filter((change) => change.exportedAt).length >= 3,
    "copied style changes are marked exported"
  );
  await waitForEval(
    page,
    "document.querySelector('#devlite-overlay-root')?.shadowRoot?.querySelectorAll('[data-style-record-section=\"verifying\"] .style-record').length >= 3",
    "copied changes move to verifying section"
  );
  await waitForEval(
    page,
    "document.querySelector('#devlite-overlay-root')?.shadowRoot?.querySelectorAll('[data-style-record-section=\"pending\"] .style-record').length === 0",
    "copied changes leave pending section"
  );
  record("copied edit records move from pending to verification", true);

  await page.send("Page.reload", { ignoreCache: true });
  await waitForEval(page, `location.href.startsWith(${JSON.stringify(demoUrl)}) && document.readyState === "complete"`, "demo page reloads after copying prompt", 10000);
  await ensureLauncher(page, demoUrl);
  await shadowClick(page, ".devlite-launcher");
  await waitForEval(page, "!!document.querySelector('#devlite-overlay-root')?.shadowRoot?.querySelector('.devlite-panel:not([hidden])')", "panel opens after reload");
  await shadowClick(page, 'button[data-tab="element"]');
  await waitForSessionState(
    cdpPort,
    extensionId,
    (session) => (session?.styleChanges ?? []).filter((change) => change.exportedAt).length >= 3 && (session?.archivedStyleChanges ?? []).length === 0,
    "reload keeps exported changes unarchived before source fix"
  );
  record("reload does not auto-archive unfixed exported edits", true);

  await evaluate(page, `
    (() => {
      const style = document.createElement("style");
      style.id = "agent-hotfix-style";
      style.textContent = '[data-testid="editable-card"] { color: rgb(179, 38, 30) !important; font-size: 23px !important; }';
      document.head.appendChild(style);
      const bodyCopy = document.querySelector(".body-copy");
      if (bodyCopy) bodyCopy.textContent = "Updated by DevLite QA prompt export.";
      document.querySelector(".muted-panel h3")?.remove();
      return true;
    })()
  `);
  await waitForSessionState(
    cdpPort,
    extensionId,
    (session) => (session?.archivedStyleChanges ?? []).filter((item) => item.archiveReason === "verified").length >= 2,
    "hot update auto-archives verified style and text edits",
    10000
  );
  await waitForEval(
    page,
    "document.querySelector('#devlite-overlay-root')?.shadowRoot?.querySelectorAll('[data-style-record-section=\"archive\"] .style-record').length >= 2",
    "verified records appear in archive section",
    10000
  );
  record("hot-loaded source changes auto-archive matching exported edits", true);

  await shadowClick(page, 'button[data-action="archive-style-record"]');
  await waitForSessionState(
    cdpPort,
    extensionId,
    (session) => (session?.archivedStyleChanges ?? []).some((item) => item.archiveReason === "manual") && (session?.styleChanges ?? []).filter((change) => change.exportedAt).length === 0,
    "manual archive clears remaining verifying edit"
  );
  record("failed exported edit can be manually marked fixed", true);

  const optionsTargetId = await browser.createTarget(`chrome-extension://${extensionId}/options.html`);
  const optionsTarget = await waitForTarget(cdpPort, (item) => item.id === optionsTargetId, "options target");
  extensionPage = await CdpSession.connect(optionsTarget.webSocketDebuggerUrl);
  await extensionPage.send("Runtime.enable");
  await waitForEval(extensionPage, "document.body.innerText.includes('DevLite')", "options page renders");
  const manifestFromOptions = await evaluate(extensionPage, "chrome.runtime.getManifest()");
  assert(!manifestFromOptions?.action?.default_popup, "toolbar action has no popup");
  const configuredActionPopup = await evaluate(extensionPage, "new Promise((resolve) => chrome.action.getPopup({}, resolve))");
  assert(configuredActionPopup === "", "chrome action popup is empty");
  record("options page renders and toolbar action has no popup", true);
  await browser.send("Target.activateTarget", { targetId: target.id });
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
  assert(
    jsonExport?.ok &&
      Array.isArray(jsonSession.events) &&
      Array.isArray(jsonSession.styleChanges) &&
      Array.isArray(jsonSession.archivedStyleChanges) &&
      jsonSession.archivedStyleChanges.length >= 3,
    "json export succeeds with archived style changes"
  );
  const promptExport = await evaluate(extensionPage, `
    new Promise((resolve) => chrome.runtime.sendMessage({ type: "generate-export", format: "prompt" }, resolve))
  `);
  const runtimePrompt = JSON.parse(promptExport.text);
  assert(promptExport?.ok && Array.isArray(runtimePrompt.changes) && runtimePrompt.changes.length === 0, "repair prompt excludes archived/exported edits");
  record("options/runtime exports markdown json and filtered repair prompt", true);

  const stopResponse = await evaluate(extensionPage, `
    new Promise((resolve) => chrome.runtime.sendMessage({ type: "stop-diagnosis" }, resolve))
  `);
  assert(stopResponse?.ok, "stop diagnosis succeeds");
  await waitForCaptureStopped(cdpPort, extensionId);
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
  if (process.platform === "darwin") {
    return execFileSync("pbpaste", { encoding: "utf8" });
  }
  if (process.platform === "win32") {
    return execFileSync("powershell.exe", ["-NoProfile", "-Command", "Get-Clipboard"], { encoding: "utf8" });
  }
  try {
    return execFileSync("wl-paste", ["--no-newline"], { encoding: "utf8" });
  } catch {
    return execFileSync("xclip", ["-selection", "clipboard", "-out"], { encoding: "utf8" });
  }
}

function cropperSelectionReadyExpression() {
  return `
    (() => {
      const selection = document.querySelector('#devlite-overlay-root')?.shadowRoot?.querySelector('.image-cropper-modal cropper-selection');
      const rect = selection?.getBoundingClientRect();
      return rect && rect.width > 20 && rect.height > 20;
    })()
  `;
}

function cropperDiagnosticsExpression() {
  return `
    (() => {
      const root = document.querySelector('#devlite-overlay-root')?.shadowRoot;
      const describe = (node) => {
        if (!node) return { exists: false };
        const rect = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        return {
          exists: true,
          tagName: node.tagName,
          className: node.className || '',
          rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          offsetWidth: node.offsetWidth,
          offsetHeight: node.offsetHeight,
          display: style.display,
          position: style.position,
          width: style.width,
          height: style.height,
          minHeight: style.minHeight,
          transform: style.transform,
          hidden: node.hidden === true
        };
      };
      const shell = root?.querySelector('.image-cropper-shell');
      const stage = root?.querySelector('.image-cropper-stage');
      const canvas = root?.querySelector('.image-cropper-modal cropper-canvas');
      const image = root?.querySelector('.image-cropper-modal cropper-image');
      const selection = root?.querySelector('.image-cropper-modal cropper-selection');
      return {
        shell: describe(shell),
        stage: describe(stage),
        canvas: describe(canvas),
        image: {
          ...describe(image),
          srcPrefix: image?.getAttribute('src')?.slice(0, 40) || '',
          imageWidth: image?.width,
          imageHeight: image?.height
        },
        selection: {
          ...describe(selection),
          x: selection?.x,
          y: selection?.y,
          selectionWidth: selection?.width,
          selectionHeight: selection?.height,
          aspectRatio: selection?.aspectRatio,
          html: selection?.outerHTML?.slice(0, 500) || ''
        },
        text: root?.textContent?.replace(/\\s+/g, ' ').trim().slice(0, 500) || ''
      };
    })()
  `;
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

async function clickRelative(session, selector, xRatio, yRatio) {
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
        return {
          x: Math.round(rect.left + rect.width * ${JSON.stringify(xRatio)}),
          y: Math.round(rect.top + rect.height * ${JSON.stringify(yRatio)})
        };
      })()
    `
  );
  assert(point, `element not found: ${selector}`);
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

async function findExtensionId(session) {
  const result = await session.send("Target.getTargets");
  const target = result.targetInfos.find(
    (item) => item.type === "service_worker" && /chrome-extension:\/\/[^/]+\/background\.js$/.test(item.url)
  ) ?? result.targetInfos.find((item) => /chrome-extension:\/\/[^/]+\/options\.html$/.test(item.url));
  return target?.url.match(/^chrome-extension:\/\/([^/]+)\//)?.[1] || "";
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

async function waitForCaptureStart(cdpPort, pageSession, extensionId) {
  const started = await waitFor(
    async () => {
      const state = await readBackgroundCaptureState(cdpPort, extensionId);
      return state?.sessionActive ? state : null;
    },
    "background capture session starts",
    8000
  ).then(
    () => true,
    () => false
  );
  if (started) return;

  const diagnostics = await collectCaptureDiagnostics(cdpPort, pageSession, extensionId);
  throw new Error(`capture did not start: ${JSON.stringify(diagnostics, null, 2)}`);
}

async function waitForCaptureStopped(cdpPort, extensionId) {
  await waitFor(
    async () => {
      const state = await readBackgroundCaptureState(cdpPort, extensionId);
      return state?.session && !state.sessionActive ? state : null;
    },
    "background capture session stops",
    8000
  );
}

async function waitForSessionState(cdpPort, extensionId, predicate, label, timeout = 8000) {
  return waitFor(
    async () => {
      const state = await readBackgroundCaptureState(cdpPort, extensionId);
      return predicate(state?.session ?? null, state) ? state : null;
    },
    label,
    timeout
  );
}

async function readBackgroundCaptureState(cdpPort, extensionId) {
  const workerTarget = (await listTargets(cdpPort)).find(
    (item) => item.type === "service_worker" && item.url.startsWith(`chrome-extension://${extensionId}/`)
  );
  if (!workerTarget?.webSocketDebuggerUrl) return null;
  const worker = await CdpSession.connect(workerTarget.webSocketDebuggerUrl);
  try {
    await worker.send("Runtime.enable");
    return await evaluate(
      worker,
      `
        (async () => {
          const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
          const tab = tabs[0] || null;
          const storage = chrome.storage?.session || chrome.storage?.local || null;
          if (!storage) {
            const response = await chrome.runtime?.sendMessage?.({ type: "get-current-session" }).catch((error) => ({
              ok: false,
              error: error instanceof Error ? error.message : String(error)
            }));
            return {
              tab: tab ? { id: tab.id, url: tab.url, title: tab.title } : null,
              sessionActive: response?.session?.active === true,
              session: response?.session ?? null,
              storageUnavailable: true,
              runtimeResponse: response
            };
          }
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

async function collectCaptureDiagnostics(cdpPort, pageSession, extensionId) {
  const panel = await evaluate(
    pageSession,
    `
      (() => {
        const root = document.querySelector("#devlite-overlay-root")?.shadowRoot;
        return {
          hasRoot: Boolean(root),
          hasDock: Boolean(root?.querySelector(".devlite-dock")),
          hasPanel: Boolean(root?.querySelector(".devlite-panel:not([hidden])")),
          text: root?.textContent?.replace(/\\s+/g, " ").trim().slice(0, 600) || ""
        };
      })()
    `
  ).catch((error) => ({ error: error instanceof Error ? error.message : String(error) }));
  const workerTarget = (await listTargets(cdpPort)).find(
    (item) => item.type === "service_worker" && item.url.startsWith(`chrome-extension://${extensionId}/`)
  );
  if (!workerTarget?.webSocketDebuggerUrl) return { panel, worker: null };
  const worker = await CdpSession.connect(workerTarget.webSocketDebuggerUrl);
  try {
    await worker.send("Runtime.enable");
    const workerState = await evaluate(
      worker,
      `
        (async () => {
          const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
          const tab = tabs[0] || null;
          const storage = chrome.storage?.session || chrome.storage?.local || null;
          const data = storage ? await storage.get("devlite:sessions") : {};
          const session = tab?.id ? data["devlite:sessions"]?.[String(tab.id)] || null : null;
          const ping = tab?.id ? await chrome.tabs.sendMessage(tab.id, { type: "devlite-ping" }).catch((error) => ({
            ok: false,
            error: error instanceof Error ? error.message : String(error)
          })) : null;
          return {
            manifest: chrome.runtime.getManifest(),
            tab: tab ? { id: tab.id, url: tab.url, title: tab.title } : null,
            session,
            ping,
            registeredScripts: chrome.scripting?.getRegisteredContentScripts
              ? await chrome.scripting.getRegisteredContentScripts().catch((error) => ({ error: error.message }))
              : "unavailable"
          };
        })()
      `
    ).catch((error) => ({ error: error instanceof Error ? error.message : String(error) }));
    return { panel, worker: workerState };
  } finally {
    await worker.close().catch(() => null);
  }
}

async function waitForStyleEditApplied(pageSession) {
  const applied = await waitForEval(
    pageSession,
    "document.querySelector('[data-testid=\"editable-card\"]').style.color === 'rgb(179, 38, 30)' || document.querySelector('[data-testid=\"editable-card\"]').style.color === '#b3261e'",
    "style edit applied",
    8000
  ).then(
    () => true,
    () => false
  );
  if (applied) return;
  const diagnostics = await evaluate(
    pageSession,
    `
      (() => {
        const root = document.querySelector("#devlite-overlay-root")?.shadowRoot;
        const editor = root?.querySelector(".style-editor-popover");
        const inputs = Array.from(editor?.querySelectorAll("[data-prop]") ?? []).map((input) => ({
          prop: input.dataset.prop,
          value: input.value
        }));
        const card = document.querySelector('[data-testid="editable-card"]');
        const body = document.querySelector(".body-copy");
        const button = document.querySelector("#state-button");
        const title = card?.querySelector("h3");
        return {
          editorTitle: editor?.querySelector(".style-editor-head strong")?.textContent || "",
          inputs,
          cardStyle: card?.getAttribute("style") || "",
          cardColor: card?.style.color || "",
          bodyStyle: body?.getAttribute("style") || "",
          bodyColor: body?.style.color || "",
          buttonStyle: button?.getAttribute("style") || "",
          buttonColor: button?.style.color || "",
          titleStyle: title?.getAttribute("style") || "",
          titleColor: title?.style.color || ""
        };
      })()
    `
  );
  throw new Error(`style edit was not applied to editable card: ${JSON.stringify(diagnostics, null, 2)}`);
}

async function waitForExtensionId(session, cdpPort, profileDir, extensionDir) {
  try {
    return await waitFor(async () => {
      const extensionId = findExtensionIdFromProfile(profileDir, extensionDir) || (await findDevLiteExtensionIdFromTargets(cdpPort));
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

async function findDevLiteExtensionIdFromTargets(cdpPort) {
  const targets = await listTargets(cdpPort).catch(() => []);
  for (const target of targets) {
    if (target.type !== "service_worker" || !/^chrome-extension:\/\/[^/]+\/.+/.test(target.url) || !target.webSocketDebuggerUrl) continue;
    const worker = await CdpSession.connect(target.webSocketDebuggerUrl).catch(() => null);
    if (!worker) continue;
    try {
      await worker.send("Runtime.enable");
      const manifest = await evaluate(worker, "chrome.runtime.getManifest()").catch(() => null);
      if (isDevLiteManifest(manifest)) {
        return target.url.match(/^chrome-extension:\/\/([^/]+)\//)?.[1] || "";
      }
    } finally {
      await worker.close().catch(() => null);
    }
  }
  return "";
}

function isDevLiteManifest(manifest) {
  return (
    manifest?.manifest_version === 3 &&
    manifest?.default_locale === "zh_CN" &&
    !manifest?.action?.default_popup &&
    manifest?.background?.service_worker === "background.js" &&
    Array.isArray(manifest?.permissions) &&
    manifest.permissions.includes("scripting") &&
    manifest.permissions.includes("storage")
  );
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
        resolve(String(extension.path ?? "")) === expectedPath
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

function pngFixtureBuffer(width, height) {
  // Minimal RGBA PNG fixture generator used to avoid checking binary test assets into the repo.
  const rowLength = width * 4 + 1;
  const raw = Buffer.alloc(rowLength * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * rowLength;
    raw[row] = 0;
    for (let x = 0; x < width; x += 1) {
      const index = row + 1 + x * 4;
      raw[index] = Math.round(217 - (x / width) * 38);
      raw[index + 1] = Math.round(119 + (y / height) * 70);
      raw[index + 2] = Math.round(87 + ((x + y) / (width + height)) * 92);
      raw[index + 3] = 255;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  const checksum = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, checksum]);
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
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
