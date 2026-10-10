// Render scripts/demo.html frame by frame with headless Chromium and encode it with ffmpeg.
// Needs: npm i playwright && npx playwright install chromium, plus ffmpeg (and img2webp for the README loop).
//   node scripts/render-demo.mjs                 -> assets/demo-10s-1080p.mp4 (1920x1080, 30 fps, H.264, no audio)
//   node scripts/render-demo.mjs --stills 2,5,8  -> assets/demo10-still-<t>.png only (for review; STILLS=<dir> to write elsewhere)
// The README ships a 720p MP4 and a 1280px animated WebP made from it (see CHANGELOG, Unreleased).
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FPS = Number(process.env.FPS || 30), args = process.argv.slice(2);
const stills = args[0] === "--stills" ? args[1].split(",").map(Number) : null;
const out = process.env.OUT || path.join(root, "assets/demo-10s-1080p.mp4");
const browser = await chromium.launch({ args: ["--allow-file-access-from-files", "--force-color-profile=srgb"] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
page.on("pageerror", (e) => console.error("page error:", e.message));
await page.goto("file://" + path.join(root, `scripts/${process.env.PAGE || "demo10"}.html`));
await page.evaluate(() => window.ready);
const shot = async (t) => { await page.evaluate((t) => window.render(t), t); return page.screenshot({ type: "png" }); };
if (stills) {
  const fs = await import("node:fs");
  for (const t of stills) fs.writeFileSync(path.join(process.env.STILLS || path.join(root, "assets"), `${process.env.PAGE || "demo10"}-still-${t}.png`), await shot(t));
} else {
  const dur = await page.evaluate(() => window.DUR), n = Math.round(dur * FPS);
  const ff = spawn("ffmpeg", ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(FPS), "-i", "-",
    "-c:v", "libx264", "-preset", "slow", "-crf", process.env.CRF || "20", "-tune", "animation", "-pix_fmt", "yuv420p",
    "-movflags", "+faststart", "-an", out], { stdio: ["pipe", "inherit", "inherit"] });
  for (let f = 0; f < n; f++) {
    const buf = await shot(f / FPS);
    if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once("drain", r));
    if (f % 150 === 0) process.stderr.write(`frame ${f}/${n}\n`);
  }
  ff.stdin.end(); await new Promise(r => ff.on("close", r));
  console.log(out);
}
await browser.close();
