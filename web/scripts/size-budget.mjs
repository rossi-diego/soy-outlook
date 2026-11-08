// Size budget for the static export (P28). Run after `next build`: `npm run size`.
//
// For every page in out/ it measures the HTML and the JavaScript the page loads up front (the
// <script src> chunks in the HTML, minus noModule polyfills), gzipped, and fails when a budget is
// exceeded. It also checks
// that ECharts is not in any page's first-load scripts: charts are loaded with next/dynamic.
// This stands in for a bundle analyzer that works with the Turbopack build.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const OUT = path.join(process.cwd(), "out");
const KB = 1024;
const BUDGET = {
  htmlRaw: { "track-record/index.html": 100 * KB, default: 100 * KB },
  // Measured without the noModule polyfill (unit B, 2026-11-08): 143-162 KB gzip per page.
  // The budget leaves ~8% headroom over the heaviest page (/), so real growth trips it.
  firstLoadJsGzip: 175 * KB,
};

if (!fs.existsSync(OUT)) {
  console.error("out/ not found: run `npm run build` first.");
  process.exit(2);
}

const pages = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!["_next", "data"].includes(e.name)) walk(p);
    } else if (e.name === "index.html") pages.push(path.relative(OUT, p).replaceAll("\\", "/"));
  }
})(OUT);

const gz = (buf) => zlib.gzipSync(buf, { level: 9 }).length;
const failures = [];
const rows = [];
for (const page of pages.sort()) {
  const html = fs.readFileSync(path.join(OUT, page));
  // noModule scripts (Next's core-js polyfill chunk) are skipped: browsers that run modules,
  // i.e. every browser the site supports, never download them.
  const srcs = [...html.toString("utf-8").matchAll(/<script\b[^>]*>/gi)]
    .map((m) => m[0])
    .filter((tag) => !/\bnomodule\b/i.test(tag))
    .map((tag) => tag.match(/\bsrc="([^"]+\.js)"/)?.[1])
    .filter(Boolean);
  let js = 0;
  let echartsUpFront = false;
  for (const src of new Set(srcs)) {
    const file = path.join(OUT, src.replace(/^\//, ""));
    if (!fs.existsSync(file)) continue;
    const buf = fs.readFileSync(file);
    js += gz(buf);
    if (/echarts|zrender/i.test(src) || buf.includes("ECharts is not Loaded") || buf.includes("zrender")) echartsUpFront = true;
  }
  const htmlBudget = BUDGET.htmlRaw[page] ?? BUDGET.htmlRaw.default;
  rows.push({ page, html_kb: +(html.length / KB).toFixed(1), first_load_js_gzip_kb: +(js / KB).toFixed(1), echarts_up_front: echartsUpFront });
  if (html.length > htmlBudget) failures.push(`${page}: HTML ${(html.length / KB).toFixed(1)} KB > ${htmlBudget / KB} KB`);
  if (js > BUDGET.firstLoadJsGzip) failures.push(`${page}: first-load JS ${(js / KB).toFixed(1)} KB gzip > ${BUDGET.firstLoadJsGzip / KB} KB`);
  if (echartsUpFront) failures.push(`${page}: ECharts is in the first-load scripts (load it via components/Chart.tsx)`);
}

console.table(rows);
if (failures.length) {
  console.error(`Size budget exceeded:\n  ${failures.join("\n  ")}`);
  process.exit(1);
}
console.log(`Size budget OK for ${rows.length} pages.`);
