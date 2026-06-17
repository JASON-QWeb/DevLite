import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const root = join(import.meta.dirname, "public");
const port = Number(process.env.PORT || 4177);

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

const server = createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://${request.headers.host}`);

  if (url.pathname === "/api/profile") {
    sendJson(response, 200, {
      id: "demo-user-001",
      name: "Avery Stone",
      role: "QA Lead",
      status: "active",
      plan: "team",
      score: 92,
      updatedAt: new Date().toISOString()
    });
    return;
  }

  if (url.pathname === "/api/xhr") {
    sendJson(response, 200, {
      source: "xhr",
      rows: [
        { label: "First paint", value: 486 },
        { label: "Hydration", value: 728 },
        { label: "Interaction", value: 1120 }
      ]
    });
    return;
  }

  if (url.pathname === "/api/slow") {
    setTimeout(() => {
      sendJson(response, 200, {
        source: "slow-api",
        latency: 2200,
        recommendation: "Cache the first page of dashboard data."
      });
    }, 2200);
    return;
  }

  if (url.pathname === "/api/error") {
    sendJson(response, 500, {
      error: "Demo backend failure",
      code: "DEMO_500",
      traceId: "trace-demo-500"
    });
    return;
  }

  if (url.pathname === "/api/large") {
    const items = Array.from({ length: 900 }, (_, index) => ({
      id: index + 1,
      name: `Large payload row ${index + 1}`,
      description: "This repeated data intentionally creates a large response for DevLite resource and response preview testing.",
      metrics: {
        load: Math.round(400 + Math.random() * 1200),
        memory: Math.round(20 + Math.random() * 140)
      }
    }));
    sendJson(response, 200, { generatedAt: new Date().toISOString(), items });
    return;
  }

  const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
  const safePath = normalize(pathname).replace(/^(\.\.[/\\])+/, "");
  const filePath = join(root, safePath);

  try {
    const body = await readFile(filePath);
    response.writeHead(200, {
      "Content-Type": mimeTypes[extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-store"
    });
    response.end(body);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`DevLite QA demo running at http://127.0.0.1:${port}`);
});

function sendJson(response, status, value) {
  const body = JSON.stringify(value, null, 2);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    "X-Demo-Trace": `trace-${status}`
  });
  response.end(body);
}
