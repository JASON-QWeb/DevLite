import { execFile, execFileSync, spawn } from "node:child_process";
import { createServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const root = resolve(import.meta.dirname, "..");
const distDir = join(root, "dist");
const tempRoot = await mkdtemp(join(tmpdir(), "devlite-qa-"));
const demoDir = join(tempRoot, "demo");
const profileDir = join(tempRoot, "profile");
const extensionRoot = join(tempRoot, "extension-root");
const extensionDir = join(extensionRoot, "extension");
const chromeCacheDir = join(tmpdir(), "devlite-browsers/chrome");
const execFileAsync = promisify(execFile);
const results = [];

let server;
let chromeProcess;
let browser;
let page;
let statePage;
let demoTargetId = "";
let statePageTargetId = "";
let activeDemoUrl = "";

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
      ws.addEventListener("error", () => reject(new Error("WebSocket connection failed")), { once: true });
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

  send(method, params = {}, timeout = 10000) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timed out waiting for CDP response: ${method}`));
      }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async createTarget(url) {
    const response = await this.send("Target.createTarget", { url });
    return response.targetId;
  }

  close() {
    this.ws.close();
    return Promise.resolve();
  }
}

try {
  await writeDemoPage(demoDir);
  await mkdir(extensionRoot, { recursive: true });
  await cp(distDir, extensionDir, { recursive: true });

  const chromePath = await findChromeExecutable();
  if (!chromePath) {
    throw new Error("Chrome executable not found. Set CHROME_BIN or allow the script to install Chrome for Testing.");
  }

  const demoPort = await freePort();
  const cdpPort = await freePort();
  server = await startDemoServer(demoDir, demoPort);
  const demoUrl = `http://127.0.0.1:${demoPort}/`;
  activeDemoUrl = demoUrl;
  record("temporary demo server starts", true, demoUrl);

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
      "--password-store=basic",
      "--use-mock-keychain",
      "--window-size=1360,920",
      "about:blank"
    ],
    { stdio: ["ignore", "pipe", "pipe"] }
  );
  chromeProcess.stdout.on("data", (chunk) => process.stdout.write(`[chrome] ${chunk}`));
  chromeProcess.stderr.on("data", (chunk) => process.stderr.write(`[chrome] ${chunk}`));

  await waitForHttp(`http://127.0.0.1:${cdpPort}/json/version`, "Chrome DevTools");
  browser = await CdpSession.fromVersion(cdpPort);
  const extensionId = await waitForExtensionId(browser, cdpPort, profileDir, extensionDir);
  record("extension loads in temporary Chrome profile", true, extensionId);

  const targetId = await browser.createTarget(demoUrl);
  const target = await waitForTarget(cdpPort, (item) => item.id === targetId, "demo page target");
  demoTargetId = target.id;
  await activateTarget(browser, demoTargetId);
  page = await CdpSession.connect(target.webSocketDebuggerUrl);
  await page.send("Runtime.enable");
  await page.send("Page.enable");
  await page.send("DOM.enable");
  await waitForEval(page, "document.readyState === 'complete'", "demo page loaded");

  await ensureLauncher(page, demoUrl, cdpPort, extensionId);
  await shadowClick(page, ".devlite-launcher");
  await waitForEval(page, "!!shadowRoot()?.querySelector('.devlite-panel:not([hidden])')", "panel opens");
  const panelRect = await evaluate(
    page,
    `(() => {
      const rect = shadowRoot()?.querySelector('.devlite-panel:not([hidden])')?.getBoundingClientRect();
      return rect ? { width: Math.round(rect.width), height: Math.round(rect.height) } : null;
    })()`
  );
  assert(panelRect?.width >= 900, `default panel width should be at least 900px, got ${panelRect?.width ?? "none"}`);
  assert(panelRect?.height >= 660, `default panel height should be at least 660px, got ${panelRect?.height ?? "none"}`);
  record("panel opens at the larger default size", true, `${panelRect.width} x ${panelRect.height}`);
  await waitForSessionState(cdpPort, extensionId, (session) => session?.active === true, "capture session starts").catch(async (error) => {
    const diagnostics = await collectCaptureDiagnostics(cdpPort, extensionId, page).catch((diagnosticError) => ({
      diagnosticError: diagnosticError instanceof Error ? diagnosticError.message : String(diagnosticError)
    }));
    throw new Error(`${error instanceof Error ? error.message : String(error)}: ${JSON.stringify(diagnostics, null, 2)}`);
  });
  record("panel opens and starts page capture", true);

  await enableResponseBodyCollection(page);
  await triggerNetworkRequests(page);
  await shadowClick(page, 'button[data-tab="network"]');
  await waitForEval(page, "shadowRoot()?.querySelectorAll('.network-row').length >= 2", "network rows captured");
  await shadowClickText(page, ".network-row", "/api/profile");
  await waitForEval(page, "(shadowRoot()?.textContent || '').includes('Avery Stone')", "response body visible");
  await shadowClick(page, 'button[data-network-detail="response"]');
  await shadowClick(page, 'button[data-action="copy-selected-network-detail"]');
  assert(readClipboard().includes("Avery Stone"), "copy current network detail should include response body");
  record("network list, response body, and detail copy work", true);

  const beforeProfileEvents = await countNetworkEvents(cdpPort, extensionId, "/api/profile");
  await page.send("Page.reload", { ignoreCache: true });
  await waitForEval(page, `location.href.startsWith(${JSON.stringify(demoUrl)}) && document.readyState === "complete"`, "demo page reloads");
  await ensureLauncher(page, demoUrl, cdpPort, extensionId);
  await waitForSessionState(cdpPort, extensionId, (session) => session?.active === true && session.collectResponseBody === true, "capture restores after reload");
  await evaluate(page, `document.getElementById("fetch-ok").click(); true;`);
  await waitForSessionState(
    cdpPort,
    extensionId,
    (session) => (session?.events ?? []).filter((event) => event.type === "network" && String(event.url || "").includes("/api/profile")).length === beforeProfileEvents + 1,
    "reload restore captures one new profile request"
  );
  await shadowClick(page, ".devlite-launcher");
  await shadowClick(page, 'button[data-tab="network"]');
  await shadowClickText(page, ".network-row", "/api/profile");
  await waitForEval(page, "(shadowRoot()?.textContent || '').includes('Avery Stone')", "response body survives same-origin reload flow");
  record("same-origin reload restores response body capture without duplicate request events", true);

  await selectPageElement(page, '[data-testid="editable-card"]');
  await describeRequirement(page, "copy-later", "Make the QA card more direct");
  await waitForEval(page, "(shadowRoot()?.textContent || '').includes('Make the QA card more direct')", "copy later requirement is pending");
  await shadowClick(page, 'button[data-action="copy-prompt"]');
  assert(readClipboard().includes("Make the QA card more direct"), "full prompt should include copy-later requirement");
  record("requirement copy later is exported in prompt", true);

  await selectPageElement(page, '[data-testid="icon-target"]');
  await describeRequirement(page, "copy-now", "Make this icon more reassuring");
  assert(readClipboard().includes("Make this icon more reassuring"), "copy now prompt should include requirement");
  await shadowClick(page, ".devlite-launcher");
  await shadowClick(page, 'button[data-tab="element"]');
  await shadowClick(page, 'button[data-action="archive-style-record"]');
  await waitForSessionState(cdpPort, extensionId, (session) => (session?.archivedStyleChanges ?? []).some((item) => item.archiveReason === "manual"), "manual archive records requirement");
  record("requirement copy now and manual archive work", true);

  await selectPageElement(page, '[data-testid="icon-target"]');
  await shadowClick(page, '[data-style-action="replace-icon"]');
  await shadowClick(page, '[data-asset-id="check"]');
  await waitForEval(page, "document.querySelector('[data-testid=\"icon-target\"] svg path') !== null", "local icon applied").catch(async (error) => {
    const diagnostics = await evaluate(
      page,
      `(() => {
        const root = shadowRoot();
        const target = document.querySelector('[data-testid="icon-target"]');
        return {
          targetHtml: target?.outerHTML || "",
          selectedText: root?.textContent?.replace(/\\s+/g, " ").trim().slice(0, 800) || "",
          localAssets: Array.from(root?.querySelectorAll("[data-asset-id]") ?? []).map((node) => node.getAttribute("data-asset-id"))
        };
      })()`
    ).catch((diagnosticError) => ({ diagnosticError: diagnosticError instanceof Error ? diagnosticError.message : String(diagnosticError) }));
    throw new Error(`${error instanceof Error ? error.message : String(error)}: ${JSON.stringify(diagnostics, null, 2)}`);
  });
  const maliciousSvg = `<svg width="32" height="32" onclick="alert(1)"><script>alert(1)</script><foreignObject><p>x</p></foreignObject><path onclick="alert(2)" fill="url(javascript:alert(3))" d="M2 2h20v20H2z"/></svg>`;
  await shadowClick(page, '[data-style-action="replace-icon"]');
  await shadowSetValue(page, "[data-icon-asset-input]", maliciousSvg);
  await shadowClick(page, '[data-style-action="apply-manual-icon"]');
  const sanitized = await evaluate(
    page,
    `(() => {
      const svg = document.querySelector('[data-testid="icon-target"] svg');
      return {
        viewBox: svg?.getAttribute('viewBox') || "",
        hasScript: !!svg?.querySelector('script'),
        hasForeignObject: !!svg?.querySelector('foreignObject'),
        hasEventAttr: !!svg?.querySelector('[onclick]'),
        fill: svg?.querySelector('path')?.getAttribute('fill') || ""
      };
    })()`
  );
  assert(sanitized.viewBox === "0 0 32 32", "manual SVG should get a viewBox from width and height");
  assert(!sanitized.hasScript && !sanitized.hasForeignObject && !sanitized.hasEventAttr, "manual SVG should remove executable markup");
  assert(!sanitized.fill, "manual SVG should remove dangerous CSS URL attributes");
  record("icon panel local assets and manual SVG sanitization work", true);

  await resizeStyleEditor(page);
  record("style editor resize handle changes dimensions", true);

  await activateTarget(browser, target.id);
  const reportResponse = await sendRuntimeFromWorker(cdpPort, extensionId, { type: "generate-report" });
  assert(reportResponse?.ok && /DevLite/.test(reportResponse.report), "report generation should succeed");
  const jsonExport = await sendRuntimeFromWorker(cdpPort, extensionId, { type: "generate-export", format: "json" });
  assert(jsonExport?.ok && JSON.parse(jsonExport.text).page.url.startsWith(demoUrl), "json export should include page context");
  record("background report and export work", true);

  await writeFile(join(tempRoot, "browser-results.json"), JSON.stringify({ demoUrl, results }, null, 2));
  console.log(`DevLite QA checks passed. Results: ${join(tempRoot, "browser-results.json")}`);
} catch (error) {
  record("qa run failed", false, error instanceof Error ? error.message : String(error));
  await writeFile(join(tempRoot, "browser-results.json"), JSON.stringify({ results }, null, 2)).catch(() => null);
  throw error;
} finally {
  await statePage?.close().catch(() => null);
  if (browser && statePageTargetId) {
    await browser.send("Target.closeTarget", { targetId: statePageTargetId }).catch(() => null);
  }
  await page?.close().catch(() => null);
  await browser?.close().catch(() => null);
  if (chromeProcess && !chromeProcess.killed) chromeProcess.kill("SIGTERM");
  await closeServer(server);
  await rm(tempRoot, { recursive: true, force: true }).catch(() => null);
}

async function writeDemoPage(dir) {
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "index.html"),
    `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>DevLite QA</title>
    <style>
      body { font-family: Arial, sans-serif; margin: 40px; color: #17202a; background: #f7f7f4; }
      main { max-width: 920px; display: grid; gap: 20px; }
      .card { padding: 22px; border: 1px solid #c9d0cc; background: white; border-radius: 8px; }
      .body-copy { margin: 0 0 12px; }
      button { margin: 4px; padding: 8px 12px; }
      #icon-target svg { width: 24px; height: 24px; vertical-align: middle; }
    </style>
  </head>
  <body>
    <main>
      <section class="card" data-testid="editable-card">
        <h1>DevLite QA card</h1>
        <p class="body-copy">Original card copy for requirement export.</p>
        <button id="icon-target" data-testid="icon-target" type="button">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h16"/></svg>
          Continue
        </button>
      </section>
      <section class="card">
        <button id="fetch-ok" type="button">Fetch profile</button>
        <button id="fetch-post" type="button">Save draft</button>
        <button id="fetch-error" type="button">Fetch error</button>
        <button id="fetch-slow" type="button">Fetch slow</button>
        <button id="fetch-large" type="button">Fetch large</button>
      </section>
      <pre id="output"></pre>
    </main>
    <script>
      const output = document.getElementById("output");
      const write = (value) => { output.textContent += value + "\\n"; };
      document.getElementById("fetch-ok").addEventListener("click", async () => {
        const data = await fetch("/api/profile?ts=" + Date.now()).then((response) => response.json());
        write(data.name + " " + data.sequence);
      });
      document.getElementById("fetch-post").addEventListener("click", async () => {
        const data = await fetch("/api/save", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ title: "Draft QA record" })
        }).then((response) => response.json());
        write(data.title);
      });
      document.getElementById("fetch-error").addEventListener("click", () => fetch("/api/error").catch(() => null));
      document.getElementById("fetch-slow").addEventListener("click", () => fetch("/api/slow").then((response) => response.text()).then(write));
      document.getElementById("fetch-large").addEventListener("click", () => fetch("/api/large").then((response) => response.text()).then((text) => write(text.slice(0, 12))));
    </script>
  </body>
</html>`
  );
}

async function startDemoServer(dir, port) {
  let sequence = 0;
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);
    if (url.pathname === "/" || url.pathname === "/index.html") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(readFileSync(join(dir, "index.html"), "utf8"));
      return;
    }
    if (url.pathname === "/api/profile") {
      sequence += 1;
      sendJson(response, { name: "Avery Stone", role: "QA", sequence });
      return;
    }
    if (url.pathname === "/api/save") {
      const body = await readRequestBody(request);
      sendJson(response, { ok: true, title: "Draft QA record", body }, 201);
      return;
    }
    if (url.pathname === "/api/error") {
      sendJson(response, { error: "Demo failure" }, 500);
      return;
    }
    if (url.pathname === "/api/slow") {
      setTimeout(() => {
        response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
        response.end("slow response");
      }, 250);
      return;
    }
    if (url.pathname === "/api/large") {
      response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
      response.end("large-response-" + "x".repeat(4096));
      return;
    }
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("not found");
  });
  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  return server;
}

function sendJson(response, data, status = 200) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(data));
}

function readRequestBody(request) {
  return new Promise((resolve) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => resolve(body));
  });
}

async function enableResponseBodyCollection(session) {
  await shadowClick(session, 'button[data-action="show-settings"]');
  await shadowEval(
    session,
    `
      const input = root.querySelector('[data-setting="collectResponseBody"]');
      input.checked = true;
      input.dispatchEvent(new Event("change", { bubbles: true }));
      root.querySelector('[data-action="save-panel-settings"]').click();
      true;
    `
  );
  await delay(300);
}

async function triggerNetworkRequests(session) {
  await evaluate(
    session,
    `
      document.getElementById("fetch-ok").click();
      document.getElementById("fetch-post").click();
      document.getElementById("fetch-error").click();
      document.getElementById("fetch-slow").click();
      document.getElementById("fetch-large").click();
      true;
    `
  );
  await delay(900);
}

async function selectPageElement(session, selector) {
  await shadowClick(session, 'button[data-tab="element"]').catch(() => null);
  await shadowClick(session, 'button[data-action="quick-select"]');
  await clickCenter(session, selector);
  await waitForEval(session, "!!shadowRoot()?.querySelector('.style-editor-popover:not([hidden])')", `style editor opens for ${selector}`);
}

async function describeRequirement(session, mode, text) {
  await shadowClick(session, '[data-style-action="describe-requirement"]');
  await shadowSetValue(session, "[data-requirement-input]", text);
  await shadowClick(session, `[data-style-action="requirement-${mode}"]`);
  await delay(300);
}

async function resizeStyleEditor(session) {
  const rect = await shadowRect(session, "[data-style-editor-resize]");
  const editorBefore = await shadowRect(session, ".style-editor-popover");
  await session.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
  await session.send("Input.dispatchMouseEvent", { type: "mousePressed", x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, button: "left", buttons: 1, clickCount: 1 });
  await session.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: rect.left + rect.width / 2 + 90, y: rect.top + rect.height / 2 + 70, button: "left", buttons: 1 });
  await session.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: rect.left + rect.width / 2 + 90, y: rect.top + rect.height / 2 + 70, button: "left", buttons: 0, clickCount: 1 });
  await delay(100);
  const editorAfter = await shadowRect(session, ".style-editor-popover");
  assert(editorAfter.width > editorBefore.width || editorAfter.height > editorBefore.height, "style editor resize should increase width or height");
}

async function countNetworkEvents(cdpPort, extensionId, urlPart) {
  const state = await readBackgroundCaptureState(cdpPort, extensionId);
  return (state?.session?.events ?? []).filter((event) => event.type === "network" && String(event.url || "").includes(urlPart)).length;
}

async function sendRuntimeFromWorker(cdpPort, extensionId, message) {
  if (!browser || !demoTargetId) {
    throw new Error("Browser or demo target is not available");
  }
  const extensionSession = await getExtensionStatePage(cdpPort, extensionId);
  await activateTarget(browser, demoTargetId);
  return evaluate(
    extensionSession,
    `new Promise((resolve) => {
      const timer = setTimeout(() => resolve({ ok: false, error: "runtime message timed out" }), 5000);
      chrome.runtime.sendMessage(${JSON.stringify(message)}, (response) => {
        const error = chrome.runtime.lastError?.message || "";
        clearTimeout(timer);
        resolve(response || { ok: false, error: error || "empty runtime response" });
      });
    })`
  );
}

async function shadowClick(session, selector) {
  return shadowEval(
    session,
    `
      const node = root.querySelector(${JSON.stringify(selector)});
      if (!node) throw new Error(${JSON.stringify(`Shadow selector not found: ${selector}`)});
      node.click();
      true;
    `
  );
}

async function shadowClickText(session, selector, text) {
  return shadowEval(
    session,
    `
      const node = Array.from(root.querySelectorAll(${JSON.stringify(selector)})).find((item) => item.textContent.includes(${JSON.stringify(text)}));
      if (!node) throw new Error(${JSON.stringify(`Shadow text selector not found: ${selector} ${text}`)});
      node.click();
      true;
    `
  );
}

async function shadowSetValue(session, selector, value) {
  return shadowEval(
    session,
    `
      const node = root.querySelector(${JSON.stringify(selector)});
      if (!node) throw new Error(${JSON.stringify(`Shadow input not found: ${selector}`)});
      node.value = ${JSON.stringify(value)};
      node.dispatchEvent(new Event("input", { bubbles: true }));
      node.dispatchEvent(new Event("change", { bubbles: true }));
      true;
    `
  );
}

async function shadowRect(session, selector) {
  return shadowEval(
    session,
    `
      const node = root.querySelector(${JSON.stringify(selector)});
      if (!node) throw new Error(${JSON.stringify(`Shadow selector not found: ${selector}`)});
      const rect = node.getBoundingClientRect();
      return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
    `
  );
}

function shadowEval(session, body) {
  return evaluate(
    session,
    `(() => {
      const root = shadowRoot();
      if (!root) throw new Error("DevLite shadow root not found");
      ${body}
    })()`
  );
}

async function clickCenter(session, selector) {
  const rect = await evaluate(
    session,
    `(() => {
      const node = document.querySelector(${JSON.stringify(selector)});
      if (!node) throw new Error(${JSON.stringify(`Selector not found: ${selector}`)});
      const rect = node.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    })()`
  );
  await session.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: rect.x, y: rect.y });
  await session.send("Input.dispatchMouseEvent", { type: "mousePressed", x: rect.x, y: rect.y, button: "left", buttons: 1, clickCount: 1 });
  await session.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: rect.x, y: rect.y, button: "left", buttons: 0, clickCount: 1 });
}

async function waitForEval(session, expression, label, timeout = 8000) {
  return waitFor(async () => Boolean(await evaluate(session, expression).catch(() => false)), label, timeout);
}

async function evaluate(session, expression) {
  const response = await session.send("Runtime.evaluate", {
    expression: `(() => {
      if (typeof window !== "undefined") {
        window.shadowRoot = window.shadowRoot || (() => document.querySelector("#devlite-overlay-root")?.shadowRoot || null);
      }
      return eval(${JSON.stringify(expression)});
    })()`,
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

async function waitForSessionState(cdpPort, extensionId, predicate, label, timeout = 8000) {
  return waitFor(async () => {
    const state = await readBackgroundCaptureState(cdpPort, extensionId);
    return predicate(state?.session ?? null, state) ? state : null;
  }, label, timeout);
}

async function readBackgroundCaptureState(cdpPort, extensionId) {
  const extensionSession = await getExtensionStatePage(cdpPort, extensionId);
  const pageUrl = activeDemoUrl;
  return evaluate(
    extensionSession,
    `(() => {
        return new Promise((resolve) => {
          const finish = (value) => {
            clearTimeout(timer);
            resolve(value);
          };
          const timer = setTimeout(() => finish({ tab: null, session: null, sessionActive: false, timeout: true }), 3000);
          chrome.tabs.query({}, (tabs) => {
            const queryError = chrome.runtime.lastError?.message || "";
            const tab = (tabs || []).find((item) => ${JSON.stringify(pageUrl)} && String(item.url || "").startsWith(${JSON.stringify(pageUrl)}))
              || (tabs || []).find((item) => /^https?:/.test(item.url || ""))
              || (tabs || [])[0]
              || null;
            const storage = chrome.storage?.session || chrome.storage?.local || null;
            if (!storage || !tab?.id) {
              finish({ tab, session: null, sessionActive: false, queryError });
              return;
            }
            storage.get("devlite:sessions", (data) => {
              const storageError = chrome.runtime.lastError?.message || "";
              const session = data?.["devlite:sessions"]?.[String(tab.id)] || null;
              finish({
                tab: { id: tab.id, url: tab.url, title: tab.title },
                sessionActive: session?.active === true,
                session,
                queryError,
                storageError
              });
            });
          });
        });
      })()`
  );
}

async function getExtensionStatePage(cdpPort, extensionId) {
  if (statePage) return statePage;
  if (!browser) throw new Error("Browser CDP session is not available");
  statePageTargetId = await browser.createTarget(`chrome-extension://${extensionId}/options.html`);
  const target = await waitForTarget(cdpPort, (item) => item.id === statePageTargetId, "extension state page target");
  statePage = await CdpSession.connect(target.webSocketDebuggerUrl);
  await statePage.send("Runtime.enable");
  await waitForEval(statePage, "document.readyState === 'complete'", "extension state page loads", 5000);
  if (demoTargetId) {
    await activateTarget(browser, demoTargetId).catch(() => null);
  }
  return statePage;
}

async function collectCaptureDiagnostics(cdpPort, extensionId, pageSession) {
  const state = await readBackgroundCaptureState(cdpPort, extensionId);
  const panel = await evaluate(
    pageSession,
    `(() => {
      const root = shadowRoot();
      return {
        href: location.href,
        readyState: document.readyState,
        hasRoot: Boolean(root),
        hasDock: Boolean(root?.querySelector(".devlite-dock")),
        hasPanel: Boolean(root?.querySelector(".devlite-panel:not([hidden])")),
        text: root?.textContent?.replace(/\\s+/g, " ").trim().slice(0, 800) || ""
      };
    })()`
  ).catch((error) => ({ error: error instanceof Error ? error.message : String(error) }));
  return { state, panel };
}

async function ensureLauncher(session, pageUrl, cdpPort, extensionId) {
  const hasLauncher = "!!shadowRoot()?.querySelector('.devlite-dock')";
  const autoInjected = await waitForEval(session, hasLauncher, "DevLite launcher auto injection", 3000).then(
    () => true,
    () => false
  );
  if (autoInjected) return;
  await session.send("Page.reload", { ignoreCache: true });
  await waitForEval(session, `location.href.startsWith(${JSON.stringify(pageUrl)}) && document.readyState === "complete"`, "demo page reloads after extension startup", 10000);
  const injectedAfterReload = await waitForEval(session, hasLauncher, "DevLite launcher exists after reload", 3000).then(
    () => true,
    () => false
  );
  if (injectedAfterReload) return;
  if (!cdpPort || !extensionId) {
    await waitForEval(session, hasLauncher, "DevLite launcher exists after reload", 10000);
    return;
  }
  const response = await sendRuntimeFromWorker(cdpPort, extensionId, { type: "open-page-panel" });
  if (!response?.ok) throw new Error(response?.error || "open-page-panel failed");
  await waitForEval(session, hasLauncher, "DevLite launcher exists after background injection", 10000);
}

async function waitForExtensionId(browserSession, cdpPort, profileDir, extensionDir) {
  try {
    return await waitFor(async () => {
      const extensionId = findExtensionIdFromProfile(profileDir, extensionDir) || (await findDevLiteExtensionIdFromTargets(cdpPort));
      return extensionId || null;
    }, "DevLite extension registration", 10000);
  } catch (error) {
    const targets = await browserSession.send("Target.getTargets").catch(() => ({ targetInfos: [] }));
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}. Targets: ${JSON.stringify(
        targets.targetInfos.map((item) => ({ type: item.type, url: item.url })).slice(0, 20)
      )}. Profile extensions: ${JSON.stringify(listProfileExtensions(profileDir))}`
    );
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
      if (extension && typeof extension === "object" && resolve(String(extension.path ?? "")) === expectedPath) {
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
      path: extension?.path,
      state: extension?.state,
      manifestName: extension?.manifest?.name
    }));
  } catch {
    return [];
  }
}

async function activateTarget(browserSession, targetId) {
  await browserSession.send("Target.activateTarget", { targetId });
}

async function waitForTarget(port, predicate, label, timeout = 8000) {
  return waitFor(async () => (await listTargets(port)).find(predicate) || null, label, timeout);
}

async function listTargets(port) {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`);
  return response.json();
}

async function waitForHttp(url, label, timeout = 8000) {
  await waitFor(async () => {
    const response = await fetch(url).catch(() => null);
    return response?.ok ? true : null;
  }, label, timeout);
}

function waitFor(fn, label, timeout = 8000, interval = 100) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const tick = async () => {
      try {
        const value = await fn();
        if (value) {
          resolve(value);
          return;
        }
      } catch {
        // Keep polling until timeout.
      }
      if (Date.now() - startedAt >= timeout) {
        reject(new Error(`Timed out waiting for ${label}`));
        return;
      }
      setTimeout(tick, interval);
    };
    void tick();
  });
}

async function freePort() {
  const server = createNetServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await closeServer(server);
  return port;
}

function closeServer(activeServer) {
  if (!activeServer) return Promise.resolve();
  return new Promise((resolve) => activeServer.close(resolve));
}

async function findChromeExecutable() {
  if (process.env.CHROME_BIN) {
    return existsSync(process.env.CHROME_BIN) ? process.env.CHROME_BIN : "";
  }

  const chromeForTesting = [
    ...findChromeForTestingExecutables(chromeCacheDir),
    "/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"
  ].find((candidate) => candidate && existsSync(candidate));
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

function record(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` - ${detail}` : ""}`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
