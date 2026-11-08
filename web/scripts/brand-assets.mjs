// Regenerates the static brand assets from their sources:
//   scripts/brand/og.html -> public/og.png (1200x630 social card, no live numbers)
//   app/icon.svg          -> app/apple-icon.png (180x180) and app/favicon.ico (16/32/48 PNG entries)
// Run from web/: node scripts/brand-assets.mjs   (needs: npx playwright install chromium)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { chromium } from "@playwright/test";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ICON = fs.readFileSync(path.join(WEB, "app", "icon.svg"), "utf-8");

async function iconPng(page, size, rounded = true) {
  const svg = rounded ? ICON : ICON.replace('rx="14"', 'rx="0"');
  const src = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<html><body style="margin:0;background:transparent"><img src="${src}" width="${size}" height="${size}" style="display:block"></body></html>`,
  );
  return page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
}

/** ICO container with PNG-encoded entries (supported by every current browser). */
function ico(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  const dir = Buffer.alloc(16 * pngs.length);
  let offset = 6 + dir.length;
  pngs.forEach(({ size, data }, i) => {
    const o = i * 16;
    dir.writeUInt8(size, o);
    dir.writeUInt8(size, o + 1);
    dir.writeUInt16LE(1, o + 4);
    dir.writeUInt16LE(32, o + 6);
    dir.writeUInt32LE(data.length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += data.length;
  });
  return Buffer.concat([header, dir, ...pngs.map((p) => p.data)]);
}

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  await page.setViewportSize({ width: 1200, height: 630 });
  await page.goto(pathToFileURL(path.join(WEB, "scripts", "brand", "og.html")).href);
  await page.screenshot({ path: path.join(WEB, "public", "og.png"), clip: { x: 0, y: 0, width: 1200, height: 630 } });

  // Apple touch icons are masked by the OS, so the square goes full-bleed.
  fs.writeFileSync(path.join(WEB, "app", "apple-icon.png"), await iconPng(page, 180, false));
  const entries = [];
  for (const size of [16, 32, 48]) entries.push({ size, data: await iconPng(page, size) });
  fs.writeFileSync(path.join(WEB, "app", "favicon.ico"), ico(entries));
} finally {
  await browser.close();
}
