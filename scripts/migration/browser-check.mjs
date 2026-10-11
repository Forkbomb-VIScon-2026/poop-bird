// Local browser verification; owns its server and never contacts the collector.
import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { createServer } from "vite";

const server = await createServer({ mode: "debug", server: { host: "127.0.0.1", port: 0, strictPort: true } });
let browser;
try {
  await server.listen();
  const url = server.resolvedUrls.local[0];
  assert.equal((await fetch(url)).status, 200);
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_EXECUTABLE || undefined,
    args: process.env.CHROMIUM_ARGS_JSON ? JSON.parse(process.env.CHROMIUM_ARGS_JSON) : [],
  });
  const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(`${url}?rust-audit=1`);
  await page.waitForFunction(() => window.poopBird?.rustAudit.cases > 30);
  const initialAudit = await page.evaluate(() => window.poopBird.rustAudit);
  assert.equal(initialAudit.error, null);
  assert.equal(initialAudit.maxError, 0);

  await page.locator("#btn-settings").click();
  await page.locator("#opt-rtx").setChecked(true);
  await page.waitForFunction(() => window.poopBird.renderer.graphics === "rtx");
  assert.equal(await page.evaluate(() => localStorage.getItem("poopBird.graphics")), "rtx");
  await page.locator("#btn-settings-done").click();

  await page.locator("#opt-tips").setChecked(false);
  await page.locator("#btn-keyboard").click();
  await page.keyboard.down("Space");
  await page.waitForFunction(() => window.poopBird.game.charge.charge === 1);
  await page.keyboard.up("Space");
  await page.waitForFunction(() => window.poopBird.game.runTime > 0.05);
  await page.keyboard.press("p");
  await page.waitForFunction(() => !document.querySelector("#screen-pause").classList.contains("hidden"));
  const paused = await page.evaluate(() => window.poopBird.game.time);
  await page.evaluate(() => new Promise(resolve => {
    let frames = 0;
    function tick() { if (++frames === 6) resolve(); else requestAnimationFrame(tick); }
    requestAnimationFrame(tick);
  }));
  assert.equal(await page.evaluate(() => window.poopBird.game.time), paused);
  await page.locator("#btn-resume").click();
  await page.waitForFunction(time => window.poopBird.game.time > time, paused);
  // Go back immediately; this smoke test doesn't rely on surviving arbitrary hazards.
  await page.keyboard.press("p");
  await page.locator("#btn-pause-menu").click();
  assert.equal(await page.evaluate(() => window.poopBird.game.demo), true);

  const detail = await page.evaluate(async () => {
    const { Game } = await import("/src/game.ts");
    const { Renderer } = await import("/src/render.ts");
    const { Sound } = await import("/src/audio.ts");
    const { SeededRng } = await import("/src/rng.ts");
    const { sprites, spriteReady } = await import("/src/rtx.ts");
    const pictures = Object.values(sprites());
    await Promise.all(pictures.map(sprite => sprite.img.decode()));
    if (!pictures.every(spriteReady)) throw new Error("photo asset failed to load");
    const canvas = document.createElement("canvas"); canvas.width = 1000; canvas.height = 600;
    const renderer = new Renderer(canvas);
    function freeze(object, seen = new WeakSet()) {
      if (!object || typeof object !== "object" || seen.has(object)) return;
      seen.add(object);
      for (const value of Object.values(object)) freeze(value, seen);
      Object.freeze(object);
    }
    const game = new Game(1000);
    game.spawnWeddingNow(); game.time = 4; game.wedding.outcome = "ruined";
    freeze(game);
    const photos = [renderer.captureBird(game), renderer.captureWedding(game, null), renderer.captureTrophy(game)];
    renderer.draw(game, 0);
    renderer.graphics = "rtx";
    renderer.draw(game, 0);
    const rtxPhotos = [renderer.captureBird(game), renderer.captureWedding(game, null), renderer.captureTrophy(game)];
    if (rtxPhotos.some(photo => !photo || photo.width <= 0)) throw new Error("RTX photo capture failed");
    if (photos.some(photo => !photo || photo.width <= 0)) throw new Error("photo capture failed");
    const sound = new Sound(); sound.unlock();
    // Five known IDs lack assets. The other 49 IDs include both shark fallbacks.
    const deadline = performance.now() + 10000;
    while (sound.buffers.size < 49 && performance.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
    let cityPixels = 0;
    for (const graphics of ["classic", "rtx"]) {
      const a = document.createElement("canvas"), b = document.createElement("canvas");
      a.width = b.width = 1000; a.height = b.height = 600;
      const referenceRenderer = new Renderer(a), rustRenderer = new Renderer(b);
      referenceRenderer.graphics = rustRenderer.graphics = graphics;
      const reference = new Game(1000, new SeededRng(1234).next); reference.startDemo();
      const rust = await window.poopBird.createRustCity(1000, 1234);
      try {
        rust.advance(0, 0, false, [{ type: "demo" }]);
        for (let batch = 0; batch < 120; batch++) {
          reference.stepDemo(1 / 120); reference.stepDemo(1 / 120);
          const frame = rust.advance(1 / 120, 2);
          if (batch % 20 !== 0) continue;
          freeze(frame);
          const random = Math.random;
          try {
            Math.random = new SeededRng(99).next; referenceRenderer.draw(reference, 1 / 60);
            Math.random = new SeededRng(99).next; rustRenderer.draw(frame, 1 / 60);
          } finally { Math.random = random; }
          const expected = a.getContext("2d").getImageData(0, 0, 1000, 600).data;
          const actual = b.getContext("2d").getImageData(0, 0, 1000, 600).data;
          for (let i = 0; i < actual.length; i++) if (actual[i] !== expected[i]) throw new Error(`${graphics} Rust city pixel mismatch at ${i}`);
          cityPixels++;
        }
        rust.advance(0, 0, false, [{ type: "reset" }, { type: "perch" }]);
        let accident = false;
        for (let i = 0; i < 40; i++) {
          const frame = rust.advance(1 / 120, 12, true);
          rustRenderer.draw(frame, 1 / 60);
          for (const event of frame.events) { sound.event(event, window.poopBird.config); accident ||= event.type === "accident"; }
        }
        if (!accident) throw new Error("Rust practice accident/event routing failed");
      } finally { rust.dispose(); }
    }
    return { photos: photos.map(photo => [photo.width, photo.height]), photoAssets: pictures.length, decoded: sound.buffers.size,
      cityPixels,
      audit: window.poopBird.rustAudit };
  });
  assert.deepEqual(detail.photos, [[200, 200], [320, 240], [320, 240]]);
  assert.equal(detail.decoded, 49);
  assert.equal(detail.cityPixels, 12);
  assert.equal(detail.audit.error, null);
  assert.equal(detail.audit.maxError, 0);
  assert.deepEqual(errors, []);
  console.log("Browser smoke passed:", { browser: browser.version(), ...detail });
  console.log("Verified keyboard takeoff, pause/resume/menu, WASM shadow checks, immutable rendering and 49 decoded audio IDs.");
  console.log("Real webcam, audible playback, Firefox/Safari and desktop frame-time parity still require verification.");
} finally {
  await browser?.close();
  await server.close();
}
