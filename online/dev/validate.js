#!/usr/bin/env node
/* Static validator for online games and the manifest. Zero dependencies.
 *
 *   node online/dev/validate.js                  games.json, online-games.json and every online game (+ the starter template)
 *   node online/dev/validate.js my-game          just online/my-game/  (also works for a game not yet in the manifest)
 *   node online/dev/validate.js --bridge=<file>  (maintainers) also check that online/dev/online-bridge.js is identical
 *                                                to the bridge shipped in EldaRemote (js/online-bridge.js) or EldaTV
 *                                                (tv/js/online-bridge.js); repeat the flag for both
 *
 * Exits 1 when there is an error. Warnings never fail the run. This is a *fast, static* sanity check; the
 * behavioural checks (sync, network faults, layout, ...) live in the test bench: online/dev/index.html.
 * See ../DEVELOPING.md for the full specification.
 */
"use strict";
const fs = require("fs"), path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const SUPPORTED_SDK = 1;
const ID_RE = /^[a-z0-9_-]{1,40}$/;
const LANGS = ["en", "fr", "nl"];

let errors = 0, warnings = 0;
const err = (where, msg) => { errors++; console.log(`  ✗ ERROR   ${where}: ${msg}`); };
const warn = (where, msg) => { warnings++; console.log(`  ! warning ${where}: ${msg}`); };
const ok = (msg) => console.log(`  ✓ ${msg}`);
const read = (p) => fs.readFileSync(p, "utf8").replace(/\r\n/g, "\n");

// ── what the TV / app shows for a game: names, description, thumbnail ───────────
const THUMB_EXT = /\.(svg|png|jpe?g|webp)$/i, THUMB_MAX = 300 * 1024;
function validateListing(w, g, { label }) {
  for (const key of [label, "description"]) {
    if (!g[key] || typeof g[key] !== "object") { err(w, `"${key}" must be an object with ${LANGS.join(", ")}`); continue; }
    for (const l of LANGS) if (typeof g[key][l] !== "string" || !g[key][l].trim()) err(w, `"${key}.${l}" is missing`);
    else if (key === "description" && g[key][l].length > 160) warn(w, `"description.${l}" is ${g[key][l].length} characters — the TV shows about 140 on three lines`);
  }
  const t = g.thumbnail;
  if (typeof t !== "string" || !t) { err(w, '"thumbnail" is missing (a path relative to the repository root, e.g. "my-game/thumbnail.svg")'); return; }
  if (/^[a-z]+:|^\/|\.\.|[\\]/i.test(t)) { err(w, `"thumbnail" must be a plain relative path inside the repository (got "${t}")`); return; }
  if (!THUMB_EXT.test(t)) { err(w, '"thumbnail" must be .svg, .png, .jpg or .webp'); return; }
  const f = path.join(ROOT, t);
  if (!fs.existsSync(f)) { err(w, `thumbnail ${t} does not exist`); return; }
  const size = fs.statSync(f).size;
  if (size > THUMB_MAX) err(w, `thumbnail ${t} is ${Math.round(size / 1024)} KB — keep it under ${THUMB_MAX / 1024} KB (it is loaded by the TV)`);
  if (/\.svg$/i.test(t)) {
    const svg = read(f);
    if (!/<svg[\s>]/.test(svg)) err(w, `${t} is not an SVG document`);
    if (/<script/i.test(svg)) err(w, `${t} must not contain scripts`);
  }
}

// ── games.json (the single-player games listed on the TV) ────────────────────
function validateGamesJson() {
  console.log("games.json");
  let list;
  try { list = JSON.parse(read(path.join(ROOT, "games.json"))); } catch (e) { err("games.json", "not valid JSON: " + e.message); return; }
  if (!Array.isArray(list)) { err("games.json", "must be an array (the companion app reads it as one)"); return; }
  const before = errors, seen = new Set();
  for (const g of list) {
    const w = `game "${g && g.id}"`;
    if (!g || typeof g.id !== "string" || !ID_RE.test(g.id)) { err(w, "id must match ^[a-z0-9_-]{1,40}$"); continue; }
    if (seen.has(g.id)) err(w, "duplicate id"); seen.add(g.id);
    if (!fs.existsSync(path.join(ROOT, g.id, "index.html"))) err(w, `${g.id}/index.html does not exist`);
    if (typeof g.label !== "string" || !g.label.trim()) err(w, '"label" (a plain string, used by the companion app) is missing');
    validateListing(w, g, { label: "labels" });
  }
  if (errors === before) ok(`${list.length} game(s) listed, each with names, description and thumbnail in ${LANGS.join("/")}`);
}

// ── manifest ─────────────────────────────────────────────────────────────────
function validateManifest() {
  console.log("online-games.json");
  const file = path.join(ROOT, "online-games.json");
  let m;
  try { m = JSON.parse(read(file)); } catch (e) { err("online-games.json", "not valid JSON: " + e.message); return []; }
  if (typeof m.sdk !== "number") err("online-games.json", '"sdk" (number) is missing');
  if (!Array.isArray(m.games)) { err("online-games.json", '"games" must be an array'); return []; }
  const seen = new Set();
  for (const g of m.games) {
    const w = `game "${g && g.id}"`;
    if (!g || typeof g.id !== "string" || !ID_RE.test(g.id)) { err(w, "id must match ^[a-z0-9_-]{1,40}$"); continue; }
    if (seen.has(g.id)) err(w, "duplicate id"); seen.add(g.id);
    if (g.id.startsWith("_")) err(w, "ids starting with _ are reserved for templates and must not be listed");
    if (g.path !== `online/${g.id}/index.html`) err(w, `path must be exactly "online/${g.id}/index.html"`);
    if (g.players !== 2) err(w, '"players" must be 2 (only 2-player games are supported)');
    if (typeof g.sdk !== "number") err(w, '"sdk" (number) is missing');
    else if (g.sdk > SUPPORTED_SDK) warn(w, `sdk ${g.sdk} is newer than what this validator knows (${SUPPORTED_SDK})`);
    validateListing(w, g, { label: "label" });
    if (!fs.existsSync(path.join(ROOT, "online", g.id, "index.html"))) err(w, `online/${g.id}/index.html does not exist`);
  }
  if (!errors) ok(`${m.games.length} game(s) listed, all entries well-formed`);
  return m.games.map((g) => g && g.id).filter(Boolean);
}

// ── one game ─────────────────────────────────────────────────────────────────
function validateGame(id) {
  console.log(`online/${id}/index.html`);
  const file = path.join(ROOT, "online", id, "index.html");
  if (!fs.existsSync(file)) { err(id, "index.html does not exist"); return; }
  const src = read(file), where = id, before = errors;

  // Structure the bridge and the apps rely on
  if (!/<script[^>]+src=["']\.\.\/elda-online\.js["']/.test(src)) err(where, 'must load the SDK with <script src="../elda-online.js">');
  if (!/EldaOnline\.connect\s*\(/.test(src)) err(where, "never calls EldaOnline.connect(...)");
  for (const h of ["getSnapshot", "onSnapshot", "onMessage", "onLink", "onPeerLeft"]) {
    if (!new RegExp("\\b" + h + "\\b").test(src)) err(where, `does not handle ${h} (see DEVELOPING.md §State and ordering)`);
  }
  if (!/\.leave\s*\(/.test(src)) err(where, "never calls sess.leave() — Escape / the gamepad's back button must quit the game");
  if (!/name=["']viewport["']/.test(src)) warn(where, 'no <meta name="viewport"> — the phone layout will not scale');
  if (!/eldaDebugState/.test(src)) warn(where, "does not define window.eldaDebugState — the bench cannot compare host and guest state");
  if (!/eldaDebugInvariant/.test(src)) warn(where, "does not define window.eldaDebugInvariant (R34) — the bench cannot flag impossible states");
  if (!/send\(\s*["']move["']/.test(src)) warn(where, `never sends a message of type "move" (R18) — the bench's stale/duplicate-move check has nothing to check`);

  // Things online games must NOT do
  for (const w of ["speechSynthesis", "SpeechSynthesisUtterance"]) if (src.includes(w)) err(where, `uses ${w}: online games run during a video call and must not speak`);
  if (/\b(fetch\s*\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon)/.test(src)) err(where, "makes its own network requests — all traffic must go through the SDK (send / publishSnapshot)");
  if (/(?:src|href)\s*=\s*["']\s*(?:https?:)?\/\//i.test(src) || /url\(\s*["']?\s*(?:https?:)?\/\//i.test(src) || /@import/.test(src)) err(where, "loads an external resource — the game must be self-contained");
  if (/window\.(top|parent)\.location|top\.location|window\.open\s*\(|location\.(href|assign|replace)\s*=/.test(src)) err(where, "navigates away / opens windows (the iframe is sandboxed and must stay put)");
  if (/\beval\s*\(|new Function\s*\(/.test(src)) err(where, "uses eval / new Function");
  if (/localStorage|sessionStorage|indexedDB|document\.cookie/.test(src)) warn(where, "uses browser storage — not needed (all state lives in the snapshot) and not shared between devices");

  // i18n
  if (!/URLSearchParams/.test(src) || !/["']lang["']/.test(src)) warn(where, 'does not read the "lang" URL parameter');
  for (const l of LANGS.slice(1)) if (!new RegExp("\\b" + l + "\\s*:\\s*\\{").test(src)) warn(where, `no "${l}:" translation block found (en, fr and nl are required)`);

  // Robustness patterns from the spec (heuristic, warnings)
  if (!/\brev\b/.test(src) || !/\bepoch\b/.test(src)) warn(where, "no snapshot rev/epoch — repeated or stale snapshots cannot be told apart (DEVELOPING.md §State and ordering)");
  if (!/\bply\b|\bseq\b|\bmoveId\b|\bmoveNo\b/.test(src)) warn(where, "moves do not seem to name the state they are based on (e.g. `ply`) — duplicates/late intents may be applied twice");
  if (!/\bfocus\b/.test(src)) warn(where, "no live opponent selection (send('focus', …)) — recommended so each player sees the other's choice before it is validated");

  // Size
  const kb = Buffer.byteLength(src) / 1024;
  if (kb > 500) err(where, `file is ${kb.toFixed(0)} KB (limit 500 KB)`); else if (kb > 200) warn(where, `file is ${kb.toFixed(0)} KB — it is loaded over the internet on every launch`);

  if (errors === before) ok("static checks passed");
}

// ── bridge copy (maintainers) ────────────────────────────────────────────────
// The bench runs online/dev/online-bridge.js, a vendored copy of the bridge the apps ship. Point this at
// the apps' copies (local checkouts) to make sure the bench still tests what the apps really run.
function checkBridge(paths) {
  console.log("online/dev/online-bridge.js (vendored copy)");
  const local = read(path.join(__dirname, "online-bridge.js"));
  for (const p of paths) {
    if (!fs.existsSync(p)) { err("bridge", `${p} not found`); continue; }
    if (read(p) === local) ok(`identical to ${p}`);
    else err("bridge", `differs from ${p} — update online/dev/online-bridge.js so the bench tests what the apps run`);
  }
}

// ── main ─────────────────────────────────────────────────────────────────────
(async () => {
  const args = process.argv.slice(2);
  const bridges = args.filter((a) => a.startsWith("--bridge=")).map((a) => a.slice(9));
  const ids = args.filter((a) => !a.startsWith("--"));
  let toCheck;
  if (ids.length) { toCheck = ids; if (ids.length === 1) { /* a game in progress: the manifest may not list it yet */ } }
  else {
    validateGamesJson();
    const listed = validateManifest();
    // every game folder, listed or not, so a pull request cannot add one without it being checked
    const folders = fs.readdirSync(path.join(ROOT, "online"), { withFileTypes: true })
      .filter((d) => d.isDirectory() && d.name !== "dev" && fs.existsSync(path.join(ROOT, "online", d.name, "index.html"))).map((d) => d.name);
    for (const f of folders) if (!listed.includes(f) && !f.startsWith("_")) err(f, `online/${f}/ is not listed in online-games.json`);
    toCheck = [...new Set([...listed, ...folders])];
  }
  if (ids.length) {
    const listed = (() => { try { return JSON.parse(read(path.join(ROOT, "online-games.json"))).games.map((g) => g.id); } catch (_) { return []; } })();
    for (const id of ids) if (!listed.includes(id) && !id.startsWith("_")) warn(id, "not listed in online-games.json yet — add an entry when it is ready");
  }
  for (const id of toCheck) { if (!ID_RE.test(id)) { err(id, "invalid id"); continue; } validateGame(id); }
  if (bridges.length) checkBridge(bridges);
  console.log(`\n${errors ? "FAILED" : "OK"}: ${errors} error(s), ${warnings} warning(s)`);
  process.exit(errors ? 1 : 0);
})();
