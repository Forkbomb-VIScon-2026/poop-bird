// Draws the Android app's launcher icons and splash screens (README "Android
// app"): the RTX pigeon (src/assets/bird-glide.png) pooping
// (src/assets/poop.png) on the game's sky, at every density, straight into
// android/app/src/main/res, plus the 512 px store icon. The output is
// committed; run this again only to change the icon:
//
//   npm install --no-save playwright-core && npx playwright-core install chromium
//   node scripts/app-icons.mjs
//
// (or CHROMIUM=/path/to/chrome node scripts/app-icons.mjs, with a Chromium you have)
//
// It draws on a canvas in headless Chromium, so it needs no image library.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const res = join(root, "android", "app", "src", "main", "res");

let chromium;
try {
  ({ chromium } = await import("playwright-core"));
} catch {
  console.error("[app-icons] needs playwright-core: npm install --no-save playwright-core && npx playwright-core install chromium");
  process.exit(1);
}

const photo = (name) => "data:image/png;base64," + readFileSync(join(root, "src", "assets", name)).toString("base64");

/** Launcher densities: px per dp. */
const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
/** The template's splash sizes (portrait; landscape swaps them). */
const SPLASH = { mdpi: [320, 480], hdpi: [480, 800], xhdpi: [720, 1280], xxhdpi: [960, 1600], xxxhdpi: [1280, 1920] };

// Every file to draw: [path under res/ (or the store icon's), kind, width, height].
const files = [];
for (const [d, k] of Object.entries(DENSITIES)) {
  files.push([`mipmap-${d}/ic_launcher_foreground.png`, "foreground", 108 * k, 108 * k]);
  files.push([`mipmap-${d}/ic_launcher_background.png`, "background", 108 * k, 108 * k]);
  // Before Android 8 (no adaptive icons): the whole icon, as a rounded square and a circle.
  files.push([`mipmap-${d}/ic_launcher.png`, "legacy", 48 * k, 48 * k]);
  files.push([`mipmap-${d}/ic_launcher_round.png`, "round", 48 * k, 48 * k]);
}
for (const [d, [w, h]] of Object.entries(SPLASH)) {
  files.push([`drawable-port-${d}/splash.png`, "splash", w, h]);
  files.push([`drawable-land-${d}/splash.png`, "splash", h, w]);
}
files.push(["drawable/splash.png", "splash", 480, 320]);
// The store listing's icon (Android Studio keeps it here too): square, the store rounds it.
files.push(["../ic_launcher-playstore.png", "store", 512, 512]);

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const page = await browser.newPage();
const images = await page.evaluate(async ({ bird, poop, files }) => {
  const load = (src) => new Promise((ok) => {
    const img = new Image();
    img.onload = () => ok(img);
    img.src = src;
  });
  const [b, p] = await Promise.all([load(bird), load(poop)]);

  const sky = (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, "#9fe0ff");
    g.addColorStop(1, "#43b6ea");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  };
  /**
   * The pigeon and its poop on a 1024 × 1024 adaptive-icon foreground: launchers
   * show the middle 72 of its 108 dp, and masks can cut down to the middle 66.
   */
  const drawBird = (ctx) => {
    // Falling poop under the tail, with speed streaks above it.
    const ps = 104, px = 432, py = 712;
    ctx.strokeStyle = "rgba(255,255,255,0.85)";
    ctx.lineCap = "round";
    ctx.lineWidth = 12;
    for (const [dx, len] of [[-34, 42], [0, 60], [34, 42]]) {
      ctx.beginPath();
      ctx.moveTo(px + dx, py - ps * 0.55 - 18);
      ctx.lineTo(px + dx, py - ps * 0.55 - 18 - len);
      ctx.stroke();
    }
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.25)";
    ctx.shadowBlur = 18;
    ctx.shadowOffsetY = 8;
    ctx.translate(px, py);
    ctx.rotate(0.3);
    ctx.drawImage(p, -ps / 2, -ps / 2, ps, ps);
    ctx.restore();
    const bw = 490, bh = (b.height * bw) / b.width;
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.25)";
    ctx.shadowBlur = 18;
    ctx.shadowOffsetY = 8;
    ctx.translate(290 + bw / 2, 335 + bh / 2);
    ctx.rotate(-0.08);
    ctx.drawImage(b, -bw / 2, -bh / 2, bw, bh);
    ctx.restore();
  };
  /** The foreground's visible middle (72 of 108 dp) drawn into a w × w box at x, y. */
  const visible = (ctx, x, y, w) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(w / (1024 * 72 / 108), w / (1024 * 72 / 108));
    ctx.translate(-1024 * 18 / 108, -1024 * 18 / 108);
    drawBird(ctx);
    ctx.restore();
  };

  const out = {};
  for (const [path, kind, w, h] of files) {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    if (kind === "foreground") {
      ctx.scale(w / 1024, h / 1024);
      drawBird(ctx);
    } else if (kind === "background") {
      sky(ctx, w, h);
    } else if (kind === "legacy" || kind === "round") {
      ctx.beginPath();
      if (kind === "round") ctx.arc(w / 2, h / 2, w / 2, 0, Math.PI * 2);
      else ctx.roundRect(w * 0.04, h * 0.04, w * 0.92, h * 0.92, w * 0.18);
      ctx.clip();
      sky(ctx, w, h);
      visible(ctx, 0, 0, w);
    } else if (kind === "store") {
      sky(ctx, w, h);
      visible(ctx, 0, 0, w);
    } else {
      // Splash: the game's sky (--sky), the icon in the middle.
      ctx.fillStyle = "#5ec8f2";
      ctx.fillRect(0, 0, w, h);
      const s = Math.min(w, h) * 0.45;
      visible(ctx, (w - s) / 2, (h - s) / 2, s);
    }
    out[path] = c.toDataURL("image/png");
  }
  return out;
}, { bird: photo("bird-glide.png"), poop: photo("poop.png"), files });
await browser.close();

for (const [path, url] of Object.entries(images)) {
  const file = join(res, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, Buffer.from(url.slice(url.indexOf(",") + 1), "base64"));
}
console.log(`[app-icons] wrote ${Object.keys(images).length} images`);
