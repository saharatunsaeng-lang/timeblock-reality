#!/usr/bin/env node
// Guards the failure this repo actually keeps hitting: code that parses fine but
// dies on wiring. Two temporal dead zone bugs shipped that way, a route pointed at
// a method nobody wrote, and a version bump missed one of the four places it lives.
// Run it before pushing: `node scripts/check.mjs`

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(join(root, file), "utf8");
const failures = [];
const fail = (check, detail) => failures.push({ check, detail });

function inlineScript(html) {
  const match = html.match(/<script>([\s\S]*?)<\/script>/);
  if (!match) throw new Error("index.html has no inline <script> block");
  return match[1];
}

function checkSyntax(label, source, extension = "js") {
  const file = join(mkdtempSync(join(tmpdir(), "tb-check-")), `probe.${extension}`);
  writeFileSync(file, source);
  try {
    execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
  } catch (error) {
    fail(`syntax: ${label}`, String(error.stderr || error).split("\n").slice(0, 3).join(" "));
  }
}

// --- 1. Everything that ships has to parse -----------------------------------
const html = read("index.html");
const appScript = inlineScript(html);
checkSyntax("index.html inline script", appScript);
for (const file of ["sw.js", "calendar-worker/src/index.js", "push-worker/src/index.js"]) {
  checkSyntax(file, read(file), file.endsWith(".mjs") ? "mjs" : "js");
}

// --- 2. init() runs before the rest of the script is evaluated ----------------
// A module-level binding declared below it dies in the temporal dead zone, which
// only surfaces for users whose state reaches that line.
const initAt = appScript.indexOf("function init()");
if (initAt === -1) {
  fail("temporal dead zone", "could not find function init() in index.html");
} else {
  const late = [...appScript.matchAll(/^ {6}(?:let|const) ([A-Za-z_$][\w$]*)/gm)]
    .filter((match) => match.index > initAt)
    .map((match) => match[1]);
  if (late.length) fail("temporal dead zone", `declared after init(): ${late.join(", ")}`);
}

// --- 3. Every routed worker method exists ------------------------------------
for (const worker of ["calendar-worker/src/index.js", "push-worker/src/index.js"]) {
  const source = read(worker);
  const routed = new Set([...source.matchAll(/return this\.([A-Za-z_$][\w$]*)\(/g)].map((m) => m[1]));
  const defined = new Set([...source.matchAll(/^ {2}(?:async )?([A-Za-z_$][\w$]*)\(/gm)].map((m) => m[1]));
  const missing = [...routed].filter((name) => !defined.has(name));
  if (missing.length) fail(`routing: ${worker}`, `routed but never defined: ${missing.join(", ")}`);
}

// --- 4. One build marker, everywhere -----------------------------------------
// A stale ?v= leaves the installed app launching at a URL the service worker never
// precached, and the Build row in More reporting something nobody deployed.
const sw = read("sw.js");
const manifest = read("manifest.webmanifest");
const markers = new Set([
  ...[...html.matchAll(/\?v=([\w-]+)/g)].map((m) => m[1]),
  ...[...sw.matchAll(/\?v=([\w-]+)/g)].map((m) => m[1]),
  ...[...manifest.matchAll(/\?v=([\w-]+)/g)].map((m) => m[1]),
]);
if (markers.size > 1) {
  fail("build marker", `must match everywhere, found: ${[...markers].join(", ")}`);
} else if (markers.size === 1) {
  const [marker] = markers;
  const slug = marker.replace(/^\d+-/, "");
  const cacheName = sw.match(/cacheName = "([^"]+)"/)?.[1] || "";
  if (!cacheName.endsWith(`-${slug}`)) {
    fail("build marker", `sw.js cacheName "${cacheName}" does not end with "-${slug}" from ?v=${marker}`);
  }
}

// --- report -------------------------------------------------------------------
if (failures.length) {
  console.error(`\n${failures.length} check(s) failed:\n`);
  for (const { check, detail } of failures) console.error(`  ✗ ${check}\n    ${detail}\n`);
  process.exit(1);
}
console.log("✓ syntax, temporal dead zone, worker routing and build marker all clean");
