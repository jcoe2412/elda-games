#!/usr/bin/env node
/* Zero-dependency static server for developing online games.
 *
 *   node online/dev/serve.js [port]        (default 8080, or $PORT)
 *
 * Serves the repository root and prints the test bench URL. Any other static
 * server works too (e.g. `python -m http.server 8080` from the repo root) — the
 * bench and the games only need to come from http://, not file://, because the
 * bridge checks the origin of every message.
 */
"use strict";
const http = require("http"), fs = require("fs"), path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const PORT = Number(process.argv[2] || process.env.PORT || 8080);
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json",
                ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".ico": "image/x-icon",
                ".mp3": "audio/mpeg", ".ogg": "audio/ogg", ".wav": "audio/wav", ".woff2": "font/woff2", ".txt": "text/plain" };

http.createServer((req, res) => {
  let rel;
  try { rel = decodeURIComponent(req.url.split("?")[0]); } catch (_) { res.writeHead(400); return res.end(); }
  let file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end("forbidden"); }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end("not found"); }
    // never cache while developing: edit, reload, see it
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
    res.end(data);
  });
}).listen(PORT, "127.0.0.1", () => {
  console.log(`Serving ${ROOT}`);
  console.log(`Test bench:  http://localhost:${PORT}/online/dev/`);
  console.log(`Two-tab dev: http://localhost:${PORT}/online/<your-game>/index.html?role=host&sid=x   and   ...?role=guest&sid=x`);
});
