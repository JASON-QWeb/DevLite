const output = document.querySelector("#output");

bind("#fetch-ok", () => fetchJson("/api/profile"));
bind("#fetch-error", () => fetchJson("/api/error"));
bind("#fetch-slow", () => fetchJson("/api/slow"));
bind("#fetch-large", () => fetchJson("/api/large"));
bind("#xhr-ok", xhrMetrics);
bind("#throw-error", () => {
  throw new Error("Demo JS error for DevLite diagnostics");
});
bind("#reject-promise", () => {
  Promise.reject(new Error("Demo unhandled rejection for DevLite diagnostics"));
});
bind("#long-task", () => {
  const started = performance.now();
  while (performance.now() - started < 260) {
    Math.sqrt(Math.random() * Number.MAX_SAFE_INTEGER);
  }
  writeOutput({ longTask: true, duration: Math.round(performance.now() - started) });
});

async function fetchJson(url) {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Demo-Client": "devlite-qa" },
      body: JSON.stringify({ from: "DevLite QA Demo", timestamp: Date.now() })
    });
    const data = await response.json();
    writeOutput({ status: response.status, data });
  } catch (error) {
    writeOutput({ error: error instanceof Error ? error.message : String(error) });
  }
}

function xhrMetrics() {
  const xhr = new XMLHttpRequest();
  xhr.open("GET", "/api/xhr");
  xhr.setRequestHeader("X-Demo-Xhr", "true");
  xhr.onload = () => {
    writeOutput({ status: xhr.status, data: JSON.parse(xhr.responseText) });
  };
  xhr.onerror = () => writeOutput({ error: "XHR failed" });
  xhr.send();
}

function writeOutput(value) {
  output.textContent = JSON.stringify(value, null, 2);
}

function bind(selector, handler) {
  document.querySelector(selector)?.addEventListener("click", handler);
}
