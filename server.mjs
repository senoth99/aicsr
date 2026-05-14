/**
 * Статика + POST /api/webhook → вебхук (URL из WEBHOOK_UPSTREAM / .env).
 * Локально: npm start  |  Прод: ./deploy.sh
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isProd = process.env.NODE_ENV === "production";
const PORT = Number(process.env.PORT) || 8765;
const UPSTREAM =
  process.env.WEBHOOK_UPSTREAM ||
  "https://senoth.cashercollection.com/webhook/bddcd127-c647-4823-9ad9-8a9dd4688621";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
};

function safeFilePath(urlPath) {
  const rel = decodeURIComponent(urlPath.split("?")[0]).replace(/^\/+/, "") || "index.html";
  const candidate = path.resolve(__dirname, rel);
  const root = path.resolve(__dirname);
  if (candidate !== root && !candidate.startsWith(root + path.sep)) return null;
  return candidate;
}

async function proxyWebhook(req, res) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = Buffer.concat(chunks);
  try {
    const upstream = await fetch(UPSTREAM, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body.length ? body : undefined,
    });
    const text = await upstream.text();
    const ct = upstream.headers.get("content-type") || "text/plain; charset=utf-8";
    res.writeHead(upstream.status, { "Content-Type": ct });
    res.end(text);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Proxy error: " + msg);
  }
}

function apiPath(url) {
  return decodeURIComponent((url || "").split("?")[0]);
}

function prodHeaders(res) {
  if (isProd) {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  }
}

const server = http.createServer((req, res) => {
  prodHeaders(res);
  const pathname = apiPath(req.url);

  if (req.method === "GET" && pathname === "/api/client-config.js") {
    const payload =
      "window.__AI_AGENTS__=" +
      JSON.stringify({ directWebhook: UPSTREAM }) +
      ";\n";
    res.writeHead(200, {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": isProd ? "public, max-age=60" : "no-store",
    });
    res.end(payload);
    return;
  }

  if (req.method === "GET" && pathname === "/api/health") {
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: true, proxy: true, env: process.env.NODE_ENV || "development" }));
    return;
  }

  if (req.method === "OPTIONS" && pathname.startsWith("/api/webhook")) {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    res.end();
    return;
  }

  if (req.method === "POST" && (pathname === "/api/webhook" || pathname === "/api/webhook/")) {
    proxyWebhook(req, res);
    return;
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Method Not Allowed");
    return;
  }

  let urlPath = pathname;
  if (urlPath === "/" || urlPath === "") urlPath = "/index.html";

  const filePath = safeFilePath(urlPath);
  if (!filePath) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Forbidden");
    return;
  }

  fs.stat(filePath, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not Found");
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const type = MIME[ext] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": type });
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(PORT, () => {
  console.log("");
  console.log("  AI Agents — http://0.0.0.0:" + PORT + "/index.html");
  console.log("  NODE_ENV=" + (process.env.NODE_ENV || "(not set)") + "  WEBHOOK_UPSTREAM=" + UPSTREAM);
  console.log("");
});
