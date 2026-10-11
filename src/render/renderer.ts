// Canvas rendering. Simple shapes, chunky outlines, no image assets (the
// optional RTX style swaps in photos, see rtx.ts). The Renderer reads the Game
// and draws a frame: draw() sets up the camera and calls each feature's
// drawing in order, from the backdrop to the HUD on the canvas.
//
// Each feature's drawing lives in its own module, named like its simulation
// in game/ (render/shark.ts draws game/shark.ts's shark). Functions that need
// more than the canvas take the View (the Renderer itself).

import { VIEW_H, type Game } from "../game";
import { RTX, RtxPlayer } from "../rtx";
import { captureTrophyPhoto, drawAngler, drawHookedCue } from "./angler";
import { drawBalloon } from "./balloons";
import { captureBirdPhoto, drawBird, drawChargeMeter } from "./bird";
import { drawFloaters, drawParticles, drawPolaroid, drawPoops, drawScreenSplats, drawSplat } from "./effects";
import { drawFish, drawPuffMeter } from "./fish";
import { drawJelly } from "./jellies";
import { drawKidAim, drawPebble } from "./kids";
import { drawObstacle } from "./obstacles";
import { drawPaparazzoTimer } from "./paparazzi";
import { drawNestFront, drawPerch } from "./perch";
import { drawPowerLine } from "./power-lines";
import { drawScenery } from "./scenery";
import { drawShark, drawSharkCue } from "./shark";
import { drawTarget } from "./street";
import type { Photo, View } from "./view";
import { captureWeddingPhoto, drawBouquet, drawDove, drawWeddingBackdrop, drawWeddingCue } from "./wedding";

export class Renderer implements View {
  ctx: CanvasRenderingContext2D;
  private scale = 1;
  width = 1000;
  /** Background scroll offset, accumulates even between runs. */
  bgOffset = 0;
  /** The paparazzi's photos of this run, by Game photo id. main.ts fills it on "photo" events. */
  readonly photos = new Map<number, Photo>();
  /** "rtx": draw with real photos where we have them (rtx.ts); "classic" (the default): all drawn. */
  graphics: "classic" | "rtx" = "classic";
  /** How far the player's mouth is open, 0..1: the (classic) bird's beak opens as far. main.ts sets it each frame. */
  mouthOpen = 0;
  /** The photo bird and fish, with their own animation state. */
  readonly rtxPlayer = new RtxPlayer();

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D not supported");
    this.ctx = ctx;
  }

  /** Fits the canvas to its CSS size. Returns the logical width (height is always VIEW_H). */
  resize(): number {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.max(1, Math.round(rect.width * dpr));
    this.canvas.height = Math.max(1, Math.round(rect.height * dpr));
    this.scale = this.canvas.height / VIEW_H;
    this.width = this.canvas.width / this.scale;
    return this.width;
  }

  draw(game: Game, dt: number): void {
    RTX.on = this.graphics === "rtx";
    if (RTX.on) this.rtxPlayer.tick(game, dt);
    const ctx = this.ctx;
    this.bgOffset += game.speed * dt;
    ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    if (game.shake > 0) {
      const s = game.shake;
      ctx.translate((Math.random() - 0.5) * s, (Math.random() - 0.5) * s);
    }
    const ocean = game.stage === "ocean";
    // The camera looks at the city, the sea below it, or (diving, leaping) both.
    ctx.save();
    ctx.translate(0, -game.cameraY);
    drawScenery(this, game);
    // Everything else lives in the current stage's coordinates.
    ctx.translate(0, game.stageOffset);
    for (const d of game.decals) drawSplat(ctx, d.x, d.y, d.r, d.seed, 0.45);
    if (game.wedding) drawWeddingBackdrop(ctx, game.wedding, game.time);
    for (const o of game.obstacles) drawObstacle(this, o, game.time);
    for (const l of game.powerLines) drawPowerLine(this, l, game.time);
    if (game.perchX !== null) drawPerch(this, game.perchX);
    // People stand on the sidewalk, in front of the buildings and poles.
    for (const t of game.targets) if (t.kind !== "car" && !t.chute) drawTarget(this, t, game.time);
    for (const b of game.balloons) drawBalloon(this, b, game.time);
    // In the air, in front of the buildings.
    for (const t of game.targets) if (t.chute) drawTarget(this, t, game.time);
    // Cars: the far lane first, the near lane in front of it.
    for (const t of game.targets) if (t.kind === "car" && t.facing === -1) drawTarget(this, t, game.time);
    for (const t of game.targets) if (t.kind === "car" && t.facing === 1) drawTarget(this, t, game.time);
    // Over the buildings, so a paparazzo's timer is never hidden.
    for (const t of game.targets) if (t.pap) drawPaparazzoTimer(this, t, game);
    for (const d of game.doves) drawDove(ctx, d, game.time);
    for (const j of game.jellies) drawJelly(this, j, game.time);
    if (game.angler) drawAngler(this, game.angler, game);
    // Under the fish, so the spines read on its nose; a chomped fish isn't drawn at all.
    if (game.shark) drawShark(this, game.shark, game);
    drawPoops(this, game);
    for (const p of game.pebbles) drawPebble(this.ctx, p);
    // During a transition the splash and bubbles fly over the creature.
    if (!game.transition) drawParticles(this, game);
    if (ocean) {
      if (!game.eaten) drawFish(this, game);
    } else drawBird(this, game);
    if (game.perchX !== null && !ocean) drawNestFront(this, game.perchX);
    if (game.shark && !game.transition) drawSharkCue(this, game.shark, game);
    if (game.angler && !game.transition) drawHookedCue(this, game.angler, game);
    // Over the bird, so the crosshair reads on it.
    if (!game.transition) for (const t of game.targets) if (t.kid) drawKidAim(this, t, game);
    if (game.bouquet) drawBouquet(ctx, game.bouquet);
    if (game.wedding && !game.transition) drawWeddingCue(this, game.wedding, game);
    if (game.transition) {
      drawParticles(this, game);
    } else if (game.phase === "playing" && !game.demo) {
      if (ocean) drawPuffMeter(this, game);
      else drawChargeMeter(this, game);
    }
    drawFloaters(this, game);
    ctx.restore();
    drawScreenSplats(this, game);
    drawPolaroid(this, game);
    if (game.flash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${Math.min(1, game.flash * 1.2)})`;
      ctx.fillRect(-40, -40, this.width + 80, VIEW_H + 80);
    }
    // Electrocution flash: the whole screen flickers.
    if (game.zapFlash > 0 && Math.floor(game.time * 24) % 2 === 0) {
      ctx.fillStyle = `rgba(220,245,255,${Math.min(0.55, game.zapFlash)})`;
      ctx.fillRect(-20, -20, this.width + 40, VIEW_H + 40);
    }
  }

  /** Keyboard-mode photo: a close-up of the bird, always caught mid-strain (that's the joke), without HUD. */
  captureBird(game: Game): Photo | null {
    return captureBirdPhoto(this, game);
  }

  /** The official wedding photo (see captureWeddingPhoto). */
  captureWedding(game: Game, face: Photo | null): Photo | null {
    return captureWeddingPhoto(this, game, face);
  }

  /** The fisherman's trophy photo (see captureTrophyPhoto). */
  captureTrophy(game: Game): Photo | null {
    return captureTrophyPhoto(this, game);
  }
}
