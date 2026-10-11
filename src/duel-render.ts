// The Doo-el's renderer: a pseudo-3D avenue into the screen, drawn with canvas
// 2D (no sprites, no WebGL), from behind and slightly above the two birds. It
// reads Duel state and the controller's HUD info; it never changes the sim.
//
// Depth cues, since depth is the main playability risk of a 3D flappy: a
// shadow under each bird, a landing reticle where a poop released now would
// land, a pass/hit ring on the next gate at the bird's position, distance fog
// and gates fading in from it.

import { drawPoopBlob, drawSplat } from "./render";
import { fitCamera, project, type DuelCamera } from "./duel-camera";
import { CROSSWALK_EVERY, SIDEWALK, birdHitsGate, type Duel, type DuelBird, type DuelEvent, type Gate, type GateRect, type DuelTarget } from "./duel";
import type { FaceBox } from "./face";
import type { PlayerId } from "./duo";

export const VIEW_H = 600;
/** Player colours: blue and orange (a colour-blind-safe pair), plus the 1/2 tags. */
export const PLAYER_COLORS = ["#3d9be9", "#ff9f1c"] as const;
const PLAYER_DARK = ["#1d5f99", "#b86200"] as const;
const OUTLINE = "#2b2d42";
const HAZE: RGB = [214, 236, 245];
const BUILDING_COLORS: RGB[] = [[232, 168, 124], [196, 202, 214], [242, 214, 160], [170, 196, 186], [222, 150, 150], [190, 170, 210]];
const CAR_COLORS = ["#ef476f", "#118ab2", "#06d6a0", "#ffd166", "#8338ec", "#f78c6b"];
const PERSON_COLORS = ["#e76f51", "#2a9d8f", "#264653", "#e9c46a", "#9b5de5", "#f15bb5"];
const BLOCK = 460;
const ALLEY = 50;

type RGB = [number, number, number];

const reducedMotion = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

function hexRgb(hex: string): RGB {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mix(a: RGB, b: RGB, t: number): RGB {
  const k = Math.min(1, Math.max(0, t));
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}

function css(c: RGB, alpha = 1): string {
  return `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${alpha})`;
}

function hash(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/** What the HUD shows for one player (from the controller). */
export interface HudPlayer {
  mode: "face" | "keys";
  /** Normalized video box of their face, when fresh. */
  faceBox: FaceBox | null;
  strain: number;
  strainActive: boolean;
  /** Steer command -1..1 (the tilt indicator). */
  steer: number;
}

export interface DuelView {
  duel: Duel;
  video: HTMLVideoElement | null;
  players: [HudPlayer, HudPlayer];
  strainOn: number;
  /** Big centred text over the game (resume countdown). */
  banner: string | null;
  /** A short line under the timer ("Players swapped seats", the controls at the start). */
  toast: string | null;
  debug: DebugOverlay | null;
}

/** Seat check: one seat. */
export interface SeatInfo {
  phase: "empty" | "reading" | "squeeze" | "ready" | "keys";
  box: FaceBox | null;
  strain: number;
  strainActive: boolean;
  /** 0..1 through the relaxed read. */
  progress: number;
  title: string;
  hint: string;
  steer: number;
}

export interface SeatView {
  video: HTMLVideoElement | null;
  /** Shown over the camera area (loading, errors). */
  message: string | null;
  seats: [SeatInfo, SeatInfo];
  strainOn: number;
  debug: DebugOverlay | null;
}

/** Debug: what the identity layer sees. */
export interface DebugOverlay {
  lines: string[];
  seats: { region: FaceBox | null; masks: FaceBox[]; lock: FaceBox | null; status: string }[];
}

interface Floater {
  x: number;
  y: number;
  z: number;
  text: string;
  color: string;
  size: number;
  life: number;
  maxLife: number;
}

interface Particle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
}

export class DuelRenderer {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private scale = 1;
  width = 1000;
  private floaters: Floater[] = [];
  private particles: Particle[] = [];
  private shake = 0;
  private time = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d")!;
  }

  resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, this.canvas.clientWidth);
    const h = Math.max(1, this.canvas.clientHeight);
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.scale = this.canvas.height / VIEW_H;
    this.width = this.canvas.width / this.scale;
  }

  reset(): void {
    this.floaters = [];
    this.particles = [];
    this.shake = 0;
  }

  // --- events → effects -------------------------------------------------------

  onEvent(e: DuelEvent, duel: Duel): void {
    const z = duel.z;
    const float = (x: number, y: number, text: string, color: string, size = 26, life = 1.1, fz = z) =>
      this.floaters.push({ x, y, z: fz, text, color, size, life, maxLife: life });
    switch (e.type) {
      case "release":
        this.puff(e.x, e.y - 20, z, e.sweet ? "#ffe066" : "#b5c99a", 6 + Math.round(e.charge * 10));
        if (e.sweet) float(e.x, e.y + 50, "PERFECT!", "#ffd000", 28);
        else if (e.charge >= 0.95) float(e.x, e.y + 50, "BIG ONE!", "#ffffff", 24, 0.8);
        break;
      case "accident":
        float(e.x, e.y + 55, "OOPS!", "#ffd6d6", 28);
        this.burst(e.x, e.y, z, 30, ["#7a4a1e", "#5c3310"]);
        this.shake = Math.max(this.shake, 8);
        break;
      case "bomb":
        float(e.x, e.y + 60, "SPLAT!", "#ffe14d", 34, 1.3);
        float(e.x, e.y + 30, `+${e.points}`, PLAYER_COLORS[e.player], 26, 1.3);
        this.burst(e.x, e.y + 10, z, 24, ["#7a4a1e", "#8b5a2b", "#ffe14d"]);
        this.shake = Math.max(this.shake, 10);
        break;
      case "bump":
        float(e.x, e.y + 40, "BONK", "#ffffff", 20, 0.6);
        break;
      case "crash":
        float(e.x, e.y + 60, e.penalty > 0 ? `CRASH −${e.penalty}` : "CRASH!", "#ff6b6b", 28, 1.3);
        this.burst(e.x, e.y, z, 26, ["#ffffff", "#adb5bd", PLAYER_COLORS[e.player]]);
        this.shake = Math.max(this.shake, 12);
        break;
      case "targetHit": {
        const label = e.combo > 1 ? `+${e.points} x${duel.comboMultiplier(e.combo).toFixed(1)}` : `+${e.points}`;
        float(e.x, e.y + 60, label, PLAYER_COLORS[e.player], 26, 1.2, e.z);
        this.burst(e.x, e.y + 5, e.z, 14, ["#6b3e14", "#ffe14d"]);
        break;
      }
      case "splat":
        this.burst(e.x, e.y + 3, e.z, 8, ["#6b3e14"]);
        if (e.comboLost && e.where === "street") float(e.x, 40, "combo lost", "#ffd6d6", 16, 0.8, e.z);
        break;
      case "respawn":
        break;
      default:
        break;
    }
  }

  private puff(x: number, y: number, z: number, color: string, n: number): void {
    for (let i = 0; i < n; i++) {
      this.particles.push({ x: x + (Math.random() - 0.5) * 20, y, z: z - 10 - Math.random() * 30, vx: (Math.random() - 0.5) * 60, vy: -20 - Math.random() * 40, life: 0.5 + Math.random() * 0.4, maxLife: 0.9, size: 4 + Math.random() * 6, color });
    }
  }

  private burst(x: number, y: number, z: number, n: number, colors: string[]): void {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI;
      const s = 60 + Math.random() * 180;
      this.particles.push({ x, y, z, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.4 + Math.random() * 0.4, maxLife: 0.8, size: 2 + Math.random() * 4, color: colors[i % colors.length] });
    }
    if (this.particles.length > 500) this.particles.splice(0, this.particles.length - 500);
  }

  // --- frame -----------------------------------------------------------------------

  private begin(): CanvasRenderingContext2D {
    const ctx = this.ctx;
    ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    return ctx;
  }

  private camera(duel: Duel): DuelCamera {
    const p = duel.params;
    return fitCamera(duel.z, {
      width: this.width,
      height: VIEW_H,
      back: p.duelCameraBack,
      camHeight: p.duelCameraHeight,
      ceiling: p.duelCeiling,
      halfWidth: p.duelAvenueHalfWidth,
    });
  }

  draw(view: DuelView, dt: number): void {
    this.time += dt;
    const duel = view.duel;
    const ctx = this.begin();
    this.shake = Math.max(0, this.shake - dt * 30);
    ctx.save();
    if (this.shake > 0 && !reducedMotion) ctx.translate((Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake);
    const cam = this.camera(duel);
    this.drawWorld(duel, cam, dt);
    ctx.restore();
    this.drawHud(view);
    if (view.debug) this.drawDebug(view.debug, view.video);
  }

  /** The avenue with the birds hovering, behind the seat check. */
  drawBackdrop(duel: Duel, dt: number): void {
    this.time += dt;
    const cam = this.camera(duel);
    this.begin();
    this.drawWorld(duel, cam, dt);
  }

  private drawWorld(duel: Duel, cam: DuelCamera, dt: number): void {
    const p = duel.params;
    const far = p.duelDrawDistance;
    const zFar = cam.z + far;
    this.drawSky(cam);
    this.drawStreet(duel, cam, zFar);
    this.drawBuildings(duel, cam, zFar, -1);
    this.drawBuildings(duel, cam, zFar, 1);
    this.drawGroundMarks(duel, cam);

    // Everything with a depth, far to near.
    type Item = { z: number; draw: () => void };
    const items: Item[] = [];
    for (const g of duel.gates) items.push({ z: g.z + g.depth / 2, draw: () => this.drawGate(g, duel, cam) });
    for (const t of duel.targets) items.push({ z: t.z, draw: () => this.drawTarget(t, cam, far) });
    for (const poop of duel.poops) {
      items.push({
        z: poop.z,
        draw: () => {
          const q = project(cam, poop.x, poop.y, poop.z);
          if (q) drawPoopBlob(this.ctx, q.x, q.y, Math.max(1.5, poop.r * q.s), poop.rot);
        },
      });
    }
    for (const b of duel.birds) items.push({ z: duel.z + (b.id === 0 ? 0.01 : 0.02), draw: () => this.drawBird(b, duel, cam) });
    // The pass/hit ring on the next gate, just in front of it.
    for (const b of duel.birds) {
      const g = nextGate(duel, b);
      if (g) items.push({ z: g.z - 0.5, draw: () => this.drawPassMarker(b, g, duel, cam) });
    }
    items.sort((a, b) => b.z - a.z);
    for (const it of items) it.draw();

    // Particles and floaters on top.
    const ctx = this.ctx;
    for (const pt of this.particles) {
      pt.vy -= 600 * dt;
      pt.x += pt.vx * dt;
      pt.y += pt.vy * dt;
      pt.life -= dt;
      const q = project(cam, pt.x, pt.y, pt.z);
      if (!q || pt.life <= 0) continue;
      ctx.globalAlpha = Math.max(0, pt.life / pt.maxLife);
      ctx.fillStyle = pt.color;
      ctx.beginPath();
      ctx.arc(q.x, q.y, Math.max(1, pt.size * q.s), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    this.particles = this.particles.filter((pt) => pt.life > 0);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const f of this.floaters) {
      f.life -= dt;
      f.y += 60 * dt;
      const q = project(cam, f.x, f.y, f.z);
      if (!q || f.life <= 0) continue;
      const k = Math.min(1, (f.life / f.maxLife) * 3);
      ctx.globalAlpha = k;
      ctx.font = `900 ${Math.round(f.size * Math.min(1.2, Math.max(0.6, q.s)))}px Trebuchet MS, system-ui, sans-serif`;
      ctx.lineWidth = 4;
      ctx.strokeStyle = OUTLINE;
      ctx.strokeText(f.text, q.x, q.y);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, q.x, q.y);
    }
    ctx.globalAlpha = 1;
    this.floaters = this.floaters.filter((f) => f.life > 0);
  }

  private fog(c: RGB, dz: number, far: number): RGB {
    return mix(c, HAZE, (dz - far * 0.3) / (far * 0.7));
  }

  private drawSky(cam: DuelCamera): void {
    const ctx = this.ctx;
    const g = ctx.createLinearGradient(0, 0, 0, cam.horizon);
    g.addColorStop(0, "#5ec8f2");
    g.addColorStop(0.75, "#bfeaf7");
    g.addColorStop(1, css(HAZE));
    ctx.fillStyle = g;
    ctx.fillRect(-40, -40, this.width + 80, cam.horizon + 41);
    // Sun and a far skyline at the horizon (no parallax: it's very far away).
    ctx.fillStyle = "#fff3b0";
    ctx.beginPath();
    ctx.arc(this.width * 0.78, cam.horizon * 0.42, 34, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(156,197,217,0.9)";
    for (let i = 0; i < 40; i++) {
      const w = 30 + hash(i) * 50;
      const h = 14 + hash(i + 50) * 46;
      const x = (i / 40) * (this.width + 100) - 50;
      ctx.fillRect(x, cam.horizon - h, w, h);
    }
  }

  /** A quad on the street plane (y = 0) from z0 to z1, x0..x1, clipped to the camera's near plane. */
  private groundQuad(cam: DuelCamera, x0: number, x1: number, z0: number, z1: number): boolean {
    const zn = Math.max(z0, cam.z + cam.near + 1);
    if (z1 <= zn) return false;
    const a = project(cam, x0, 0, zn);
    const b = project(cam, x1, 0, zn);
    const c = project(cam, x1, 0, z1);
    const d = project(cam, x0, 0, z1);
    if (!a || !b || !c || !d) return false;
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.lineTo(c.x, c.y);
    ctx.lineTo(d.x, d.y);
    ctx.closePath();
    return true;
  }

  private drawStreet(duel: Duel, cam: DuelCamera, zFar: number): void {
    const ctx = this.ctx;
    const W = duel.params.duelAvenueHalfWidth;
    const road = W - SIDEWALK;
    const zNear = cam.z + cam.near + 1;
    // Ground beyond the buildings (alleys), then the sidewalks and the road.
    ctx.fillStyle = "#b9b3a3";
    ctx.fillRect(-40, cam.horizon, this.width + 80, VIEW_H - cam.horizon + 40);
    ctx.fillStyle = "#d9d4c7";
    if (this.groundQuad(cam, -W - 40, W + 40, zNear, zFar)) ctx.fill();
    ctx.fillStyle = "#4a4e69";
    if (this.groundQuad(cam, -road, road, zNear, zFar)) ctx.fill();
    // Curbs.
    ctx.fillStyle = "#9e9a8f";
    for (const s of [-1, 1]) if (this.groundQuad(cam, s * road - 4, s * road + 4, zNear, zFar)) ctx.fill();
    // Sidewalk slabs.
    ctx.fillStyle = "#c2bcac";
    for (let z = Math.ceil(zNear / 120) * 120; z < zFar; z += 120) {
      for (const s of [-1, 1]) if (this.groundQuad(cam, Math.min(s * road, s * (W + 40)), Math.max(s * road, s * (W + 40)), z, z + 5)) ctx.fill();
    }
    // Centre line (double yellow) and dashed lane lines.
    ctx.fillStyle = "#ffd166";
    for (const x of [-8, 4]) if (this.groundQuad(cam, x, x + 4, zNear, zFar)) ctx.fill();
    ctx.fillStyle = "#f2e9e4";
    for (let z = Math.ceil(zNear / 140) * 140; z < zFar; z += 140) {
      for (const x of [-road / 2, road / 2]) if (this.groundQuad(cam, x - 3, x + 3, z, z + 70)) ctx.fill();
    }
    // Crosswalks.
    for (let z = Math.ceil(zNear / CROSSWALK_EVERY) * CROSSWALK_EVERY; z < zFar; z += CROSSWALK_EVERY) {
      for (let x = -road + 10; x < road - 20; x += 40) if (this.groundQuad(cam, x, x + 22, z - 40, z + 40)) ctx.fill();
    }
    // Distance haze over the street: depth on a flat plane is just screen height.
    const fogFar = project(cam, 0, 0, zFar)?.y ?? cam.horizon;
    const fogStart = project(cam, 0, 0, cam.z + duel.params.duelDrawDistance * 0.3)?.y ?? cam.horizon + 40;
    const g = ctx.createLinearGradient(0, fogFar - 1, 0, fogStart);
    g.addColorStop(0, css(HAZE, 1));
    g.addColorStop(1, css(HAZE, 0));
    ctx.fillStyle = g;
    ctx.fillRect(-40, cam.horizon - 1, this.width + 80, fogStart - cam.horizon + 2);
  }

  /** Poop splats on the street, the birds' shadows and their landing reticles. */
  private drawGroundMarks(duel: Duel, cam: DuelCamera): void {
    const ctx = this.ctx;
    const far = duel.params.duelDrawDistance;
    for (const d of duel.decals) {
      const q = project(cam, d.x, 0, d.z);
      if (!q || q.dz > far) continue;
      ctx.save();
      ctx.translate(q.x, q.y);
      ctx.scale(1, 0.35);
      drawSplat(ctx, 0, 0, Math.max(1, d.r * q.s), d.seed, 0.8);
      ctx.restore();
    }
    for (const poop of duel.poops) {
      const q = project(cam, poop.x, 0, poop.z);
      if (!q) continue;
      ctx.fillStyle = "rgba(43,45,66,0.25)";
      ctx.beginPath();
      ctx.ellipse(q.x, q.y, poop.r * q.s, poop.r * q.s * 0.35, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    const R = duel.params.duelBirdRadius;
    for (const b of duel.birds) {
      const q = project(cam, b.x, 0, duel.z);
      if (!q) continue;
      const alt = Math.min(1, b.y / Math.max(1, duel.params.duelCeiling));
      ctx.fillStyle = `rgba(43,45,66,${0.42 - alt * 0.25})`;
      ctx.beginPath();
      ctx.ellipse(q.x, q.y, R * q.s * (1.3 - alt * 0.5), R * q.s * 0.4 * (1.3 - alt * 0.5), 0, 0, Math.PI * 2);
      ctx.fill();
    }
    if (duel.phase !== "playing") return;
    for (const b of duel.birds) {
      const spot = duel.landingSpot(b.id);
      if (!spot) continue;
      const q = project(cam, spot.x, 0, Math.min(spot.z, cam.z + far));
      if (!q) continue;
      const r = Math.max(6, 26 * q.s);
      const charging = b.charge.charge > 0;
      ctx.save();
      ctx.translate(q.x, q.y);
      ctx.scale(1, 0.4);
      ctx.lineWidth = 5;
      ctx.strokeStyle = OUTLINE;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.lineWidth = charging ? 4 : 3;
      ctx.strokeStyle = PLAYER_COLORS[b.id];
      ctx.setLineDash(charging ? [] : [8, 6]);
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = PLAYER_COLORS[b.id];
      ctx.beginPath();
      ctx.arc(0, 0, Math.max(2, r * 0.18), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      ctx.font = `900 ${Math.round(Math.max(10, r * 0.7))}px Trebuchet MS, system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.lineWidth = 3;
      ctx.strokeStyle = OUTLINE;
      ctx.strokeText(String(b.id + 1), q.x, q.y - r * 0.4 - 8);
      ctx.fillStyle = PLAYER_COLORS[b.id];
      ctx.fillText(String(b.id + 1), q.x, q.y - r * 0.4 - 8);
    }
  }

  // --- buildings ---------------------------------------------------------------

  private drawBuildings(duel: Duel, cam: DuelCamera, zFar: number, side: -1 | 1): void {
    const ctx = this.ctx;
    const W = duel.params.duelAvenueHalfWidth;
    const far = duel.params.duelDrawDistance;
    const xi = side * (W + 40);
    const depth = 360;
    const first = Math.floor((cam.z + cam.near) / BLOCK);
    const last = Math.floor(zFar / BLOCK);
    for (let i = last; i >= first; i--) {
      const seed = i * 2 + (side > 0 ? 1 : 0);
      const z0 = i * BLOCK;
      const z1 = z0 + BLOCK - ALLEY;
      const zn = Math.max(z0, cam.z + cam.near + 1);
      if (z1 <= zn) continue;
      const h = 200 + hash(seed) * 480;
      const base = BUILDING_COLORS[Math.floor(hash(seed + 7) * BUILDING_COLORS.length)];
      const dzMid = (zn + z1) / 2 - cam.z;
      const wall = this.fog(mix(base, [0, 0, 0], 0.18), dzMid, far);
      // Inner wall (facing the avenue).
      const a = project(cam, xi, 0, zn);
      const b = project(cam, xi, h, zn);
      const c = project(cam, xi, h, z1);
      const d = project(cam, xi, 0, z1);
      if (!a || !b || !c || !d) continue;
      ctx.fillStyle = css(wall);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.lineTo(c.x, c.y);
      ctx.lineTo(d.x, d.y);
      ctx.closePath();
      ctx.fill();
      // Windows.
      if (dzMid < far * 0.75) {
        ctx.fillStyle = css(this.fog([120, 160, 190], dzMid, far));
        for (let wy = 50; wy < h - 30; wy += 70) {
          for (let wz = z0 + 40; wz < z1 - 40; wz += 80) {
            if (wz < zn) continue;
            const p0 = project(cam, xi, wy, wz);
            const p1 = project(cam, xi, wy + 36, wz + 34);
            if (!p0 || !p1) continue;
            const q1 = project(cam, xi, wy, wz + 34)!;
            const q2 = project(cam, xi, wy + 36, wz)!;
            ctx.beginPath();
            ctx.moveTo(p0.x, p0.y);
            ctx.lineTo(q1.x, q1.y);
            ctx.lineTo(p1.x, p1.y);
            ctx.lineTo(q2.x, q2.y);
            ctx.closePath();
            ctx.fill();
          }
        }
      }
      // Front face (facing the camera), when it's in front of the camera.
      if (z0 > cam.z + cam.near) {
        const e = project(cam, xi + side * depth, 0, z0);
        const f = project(cam, xi + side * depth, h, z0);
        if (e && f) {
          ctx.fillStyle = css(this.fog(base, z0 - cam.z, far));
          ctx.fillRect(Math.min(a.x, e.x), f.y, Math.abs(e.x - a.x), a.y - f.y);
          ctx.strokeStyle = css(this.fog([43, 45, 66], z0 - cam.z, far), 0.6);
          ctx.lineWidth = 1.5;
          ctx.strokeRect(Math.min(a.x, e.x), f.y, Math.abs(e.x - a.x), a.y - f.y);
        }
      }
      // Roof edge.
      ctx.strokeStyle = css(this.fog([43, 45, 66], dzMid, far), 0.5);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(c.x, c.y);
      ctx.stroke();
    }
  }

  // --- gates -------------------------------------------------------------------------

  /** Draws a solid box (the faces the camera can see), fogged by depth. */
  private drawBox(cam: DuelCamera, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, color: RGB, far: number, alpha: number): void {
    const zn = Math.max(z0, cam.z + cam.near + 1);
    if (z1 <= zn) return;
    const ctx = this.ctx;
    const dz = zn - cam.z;
    const c = this.fog(color, dz, far);
    const P = (x: number, y: number, z: number) => project(cam, x, y, z);
    const quad = (pts: ({ x: number; y: number } | null)[], fill: RGB) => {
      if (pts.some((p) => !p)) return;
      ctx.fillStyle = css(fill, alpha);
      ctx.beginPath();
      ctx.moveTo(pts[0]!.x, pts[0]!.y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i]!.x, pts[i]!.y);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = css(this.fog([43, 45, 66], dz, far), alpha * 0.8);
      ctx.lineWidth = 1.5;
      ctx.stroke();
    };
    // Sides and top/bottom first, the front face last.
    if (cam.y > y1) quad([P(x0, y1, zn), P(x1, y1, zn), P(x1, y1, z1), P(x0, y1, z1)], mix(c, [255, 255, 255], 0.15));
    if (cam.y < y0) quad([P(x0, y0, zn), P(x1, y0, zn), P(x1, y0, z1), P(x0, y0, z1)], mix(c, [0, 0, 0], 0.25));
    if (cam.x < x0) quad([P(x0, y0, zn), P(x0, y1, zn), P(x0, y1, z1), P(x0, y0, z1)], mix(c, [0, 0, 0], 0.15));
    if (cam.x > x1) quad([P(x1, y0, zn), P(x1, y1, zn), P(x1, y1, z1), P(x1, y0, z1)], mix(c, [0, 0, 0], 0.15));
    if (z0 > cam.z + cam.near) quad([P(x0, y0, z0), P(x1, y0, z0), P(x1, y1, z0), P(x0, y1, z0)], c);
  }

  private gateAlpha(g: Gate, duel: Duel, cam: DuelCamera): number {
    const far = duel.params.duelDrawDistance;
    const dz = g.z - cam.z;
    let a = Math.min(1, Math.max(0, (far - dz) / (far * 0.15)));
    // Once the birds are through, it fades so it doesn't hide them.
    if (g.z + g.depth < duel.z) a *= 0.35;
    if (g.ghost) a *= 0.3;
    return a;
  }

  private drawGate(g: Gate, duel: Duel, cam: DuelCamera): void {
    const far = duel.params.duelDrawDistance;
    if (g.z - cam.z > far || g.z + g.depth < cam.z + cam.near) return;
    const alpha = this.gateAlpha(g, duel, cam);
    if (alpha <= 0.01) return;
    const W = duel.params.duelAvenueHalfWidth;
    const lim = W + 360;
    const z1 = g.z + g.depth;
    const box = (r: GateRect, color: RGB) =>
      this.drawBox(cam, Math.max(r.x0, -lim), Math.min(r.x1, lim), r.y0, r.y1, g.z, z1, color, far, alpha);
    if (g.kind === "finish") return this.drawFinish(g, duel, cam, alpha);
    if (g.kind === "footbridge") {
      // Pillars on the sidewalks (outside the birds' reach).
      const deck = g.rects[0];
      for (const s of [-1, 1]) this.drawBox(cam, s > 0 ? W + 50 : -W - 80, s > 0 ? W + 80 : -W - 50, 0, deck.y0, g.z + 10, z1 - 10, [140, 150, 160], far, alpha);
      box(deck, [154, 165, 177]);
      // Railings.
      this.drawBox(cam, -lim, lim, deck.y1, deck.y1 + 16, g.z, g.z + 4, [80, 90, 100], far, alpha);
    } else if (g.kind === "wires") {
      const top = Math.max(...g.rects.map((r) => r.y1));
      for (const s of [-1, 1]) this.drawBox(cam, s * (W + 20) - 6, s * (W + 20) + 6, 0, top + 30, g.z - 2, g.z + 10, [108, 117, 125], far, alpha);
      for (const r of g.rects) box(r, [43, 45, 66]);
    } else if (g.kind === "banner") {
      for (const r of g.rects) box(r, r.part === "pole" ? [108, 117, 125] : [239, 71, 111]);
      const cloth = g.rects.find((r) => r.part === "cloth");
      if (cloth) this.drawBannerText(cam, cloth, g, alpha, W);
    } else if (g.kind === "arch") {
      for (const r of g.rects) box(r, [194, 106, 74]);
      if (g.opening) {
        // A light trim round the hole, to read it from far.
        const o = g.opening;
        const a = project(cam, o.x0, o.y1, g.z);
        const b = project(cam, o.x1, o.y0, g.z);
        if (a && b && g.z > cam.z + cam.near) {
          this.ctx.strokeStyle = `rgba(255,243,176,${alpha})`;
          this.ctx.lineWidth = Math.max(2, 10 * a.s);
          this.ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
        }
      }
    }
    // Poop on the gate.
    for (const s of g.splats) {
      const q = project(cam, s.x, s.y, g.z - 1);
      if (q) drawSplat(this.ctx, q.x, q.y, Math.max(1, s.r * q.s), s.seed, alpha);
    }
  }

  private drawBannerText(cam: DuelCamera, cloth: GateRect, g: Gate, alpha: number, W: number): void {
    const x0 = Math.max(cloth.x0, -W - 40);
    const x1 = Math.min(cloth.x1, W + 40);
    const q = project(cam, (x0 + x1) / 2, (cloth.y0 + cloth.y1) / 2, g.z - 1);
    if (!q || g.z <= cam.z + cam.near) return;
    const words = ["💩 FEST", "SQUEEZE!", "NO POOPING", "PUSH IT", "GOOD LUCK"];
    const ctx = this.ctx;
    ctx.globalAlpha = alpha;
    ctx.font = `900 ${Math.max(6, Math.round(44 * q.s))}px Trebuchet MS, system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#fffaf0";
    ctx.fillText(words[Math.floor(g.seed) % words.length], q.x, q.y);
    ctx.globalAlpha = 1;
  }

  private drawFinish(g: Gate, duel: Duel, cam: DuelCamera, alpha: number): void {
    const W = duel.params.duelAvenueHalfWidth;
    const far = duel.params.duelDrawDistance;
    const top = Math.min(duel.params.duelCeiling + 40, 520);
    for (const s of [-1, 1]) this.drawBox(cam, s * (W + 10) - 8, s * (W + 10) + 8, 0, top, g.z, g.z + 16, [255, 255, 255], far, alpha);
    // Checkered banner.
    const y0 = top - 60;
    const n = 16;
    const zf = g.z;
    if (zf <= cam.z + cam.near) return;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < 2; j++) {
        const xa = -W - 10 + ((2 * W + 20) * i) / n;
        const xb = xa + (2 * W + 20) / n;
        const ya = y0 + j * 30;
        const a = project(cam, xa, ya + 30, zf);
        const b = project(cam, xb, ya, zf);
        if (!a || !b) continue;
        this.ctx.fillStyle = (i + j) % 2 ? `rgba(43,45,66,${alpha})` : `rgba(255,255,255,${alpha})`;
        this.ctx.fillRect(a.x, a.y, b.x - a.x, b.y - a.y);
      }
    }
    const q = project(cam, 0, y0 + 30, zf - 1);
    if (q) {
      const ctx = this.ctx;
      ctx.font = `900 ${Math.max(8, Math.round(56 * q.s))}px Trebuchet MS, system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.lineWidth = Math.max(2, 8 * q.s);
      ctx.strokeStyle = OUTLINE;
      ctx.strokeText("FINISH", q.x, q.y);
      ctx.fillStyle = "#ffd166";
      ctx.fillText("FINISH", q.x, q.y);
    }
  }

  private drawPassMarker(b: DuelBird, g: Gate, duel: Duel, cam: DuelCamera): void {
    const q = project(cam, b.x, b.y, g.z);
    if (!q) return;
    const hits = birdHitsGate(b.x, b.y, duel.params.duelBirdRadius, g);
    const ctx = this.ctx;
    const r = duel.params.duelBirdRadius * q.s;
    const near = 1 - Math.min(1, (g.z - duel.z) / Math.max(1, duel.speed * 1.2));
    ctx.save();
    ctx.globalAlpha = 0.5 + 0.5 * near;
    ctx.lineWidth = 6;
    ctx.strokeStyle = OUTLINE;
    ctx.beginPath();
    ctx.arc(q.x, q.y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = hits ? "#ff4d4d" : "#7ae582";
    ctx.beginPath();
    ctx.arc(q.x, q.y, r, 0, Math.PI * 2);
    ctx.stroke();
    if (hits) {
      ctx.beginPath();
      ctx.moveTo(q.x - r * 0.5, q.y - r * 0.5);
      ctx.lineTo(q.x + r * 0.5, q.y + r * 0.5);
      ctx.moveTo(q.x + r * 0.5, q.y - r * 0.5);
      ctx.lineTo(q.x - r * 0.5, q.y + r * 0.5);
      ctx.stroke();
    }
    ctx.restore();
  }

  // --- targets -----------------------------------------------------------------------

  private drawTarget(t: DuelTarget, cam: DuelCamera, far: number): void {
    const dz = t.z - cam.z;
    if (dz > far || dz < cam.near + 10) return;
    const alpha = Math.min(1, (far - dz) / (far * 0.1));
    const ctx = this.ctx;
    if (t.kind === "car") {
      const col = hexRgb(CAR_COLORS[t.color % CAR_COLORS.length]);
      const z0 = t.z - t.d / 2;
      const z1 = t.z + t.d / 2;
      this.drawBox(cam, t.x - t.w / 2, t.x + t.w / 2, 4, t.h * 0.55, z0, z1, col, far, alpha);
      this.drawBox(cam, t.x - t.w * 0.4, t.x + t.w * 0.4, t.h * 0.55, t.h, z0 + t.d * 0.25, z1 - t.d * 0.3, [60, 70, 90], far, alpha);
      // Lights on the face toward the camera: red tail lights going away, headlights coming.
      const q = project(cam, t.x, t.h * 0.35, z0);
      if (q && z0 > cam.z + cam.near) {
        ctx.fillStyle = t.vz > 0 ? "#ff4d4d" : "#fff3b0";
        for (const s of [-1, 1]) ctx.fillRect(q.x + s * t.w * 0.36 * q.s - 4 * q.s, q.y - 3 * q.s, 8 * q.s, 6 * q.s);
      }
      this.drawTargetSplats(t, cam, t.h);
    } else if (t.kind === "pedestrian") {
      const q = project(cam, t.x, 0, t.z);
      if (!q) return;
      const s = q.s;
      const h = t.h * s;
      const col = PERSON_COLORS[t.color % PERSON_COLORS.length];
      ctx.globalAlpha = alpha;
      ctx.lineWidth = Math.max(1, 2 * s);
      ctx.strokeStyle = OUTLINE;
      const step = Math.sin(this.time * 8 + t.seed) * 4 * s;
      ctx.fillStyle = "#2b2d42";
      ctx.fillRect(q.x - 6 * s + step * 0.3, q.y - h * 0.42, 5 * s, h * 0.42);
      ctx.fillRect(q.x + 1 * s - step * 0.3, q.y - h * 0.42, 5 * s, h * 0.42);
      ctx.fillStyle = t.hitFlash > 0 ? "#fff" : col;
      ctx.beginPath();
      ctx.roundRect(q.x - 9 * s, q.y - h * 0.8, 18 * s, h * 0.42, 5 * s);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#ffe2bd";
      ctx.beginPath();
      ctx.arc(q.x, q.y - h * 0.9, 7 * s, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.globalAlpha = 1;
      this.drawTargetSplats(t, cam, t.h);
    } else {
      // Statue on the median: a plinth and a figure with a raised arm.
      this.drawBox(cam, t.x - t.w / 2, t.x + t.w / 2, 0, 30, t.z - t.d / 2, t.z + t.d / 2, [180, 180, 170], far, alpha);
      const q = project(cam, t.x, 30, t.z);
      if (!q) return;
      const s = q.s;
      const h = (t.h - 30) * s;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = t.hitFlash > 0 ? "#fff" : "#8fa3a8";
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = Math.max(1, 2 * s);
      ctx.beginPath();
      ctx.roundRect(q.x - 12 * s, q.y - h * 0.75, 24 * s, h * 0.75, 6 * s);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(q.x, q.y - h * 0.86, 10 * s, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(q.x + 10 * s, q.y - h * 0.65);
      ctx.lineTo(q.x + 22 * s, q.y - h * 1.0);
      ctx.lineWidth = Math.max(2, 6 * s);
      ctx.stroke();
      ctx.font = `900 ${Math.max(8, Math.round(18 * s))}px Trebuchet MS, system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.fillStyle = "#ffd166";
      ctx.fillText("×2", q.x, q.y - h * 1.15);
      ctx.globalAlpha = 1;
      this.drawTargetSplats(t, cam, t.h);
    }
  }

  private drawTargetSplats(t: DuelTarget, cam: DuelCamera, h: number): void {
    const n = Math.min(4, t.splats);
    for (let i = 0; i < n; i++) {
      const q = project(cam, t.x + (hash(t.seed + i) - 0.5) * t.w * 0.6, h - 2, t.z + (hash(t.seed + i + 9) - 0.5) * t.d * 0.4);
      if (q) drawSplat(this.ctx, q.x, q.y, Math.max(1.5, 9 * q.s), t.seed + i, 1);
    }
  }

  // --- birds (seen from behind) ------------------------------------------------------

  private drawBird(b: DuelBird, duel: Duel, cam: DuelCamera): void {
    const q = project(cam, b.x, b.y, duel.z);
    if (!q) return;
    const ctx = this.ctx;
    const c = b.charge.charge;
    const R = duel.params.duelBirdRadius * q.s;
    const r = R * (1 + c * 0.28);
    const stunned = b.charge.stun > 0;
    const crashed = b.state === "crashed";
    if (b.invuln > 0 && Math.floor(this.time * 10) % 2 === 0) ctx.globalAlpha = 0.45;
    ctx.save();
    let sx = 0;
    let sy = 0;
    if (c > 0.6 && !reducedMotion) {
      const amp = ((c - 0.6) * 4 + duel.overstrain(b.id) * 4) * q.s;
      sx = (Math.random() - 0.5) * amp;
      sy = (Math.random() - 0.5) * amp;
    }
    ctx.translate(q.x + sx, q.y + sy);
    // Banking: the bird leans into its turn.
    const bank = Math.max(-0.5, Math.min(0.5, (b.vx / Math.max(1, duel.params.duelLateralSpeed)) * 0.45));
    ctx.rotate(crashed || stunned ? b.rot : bank);
    const base = hexRgb(PLAYER_COLORS[b.id]);
    const body = mix(base, [239, 71, 111], Math.min(1, c * 1.1));
    ctx.lineWidth = Math.max(1.5, 3 * q.s);
    ctx.strokeStyle = OUTLINE;

    // Wings: out to the sides, flapping (tucked up while charging).
    const flapping = b.flap > 0 || crashed;
    const wing = flapping ? Math.sin(this.time * 40) * 0.8 : c > 0 ? -0.5 - c * 0.3 : Math.sin(this.time * 5 + b.id) * 0.25;
    for (const s of [-1, 1]) {
      ctx.save();
      ctx.translate(s * r * 0.75, -r * 0.1);
      ctx.rotate(s * wing);
      ctx.fillStyle = css(mix(body, [0, 0, 0], 0.18));
      ctx.beginPath();
      ctx.ellipse(s * r * 0.55, 0, r * 0.7, r * 0.28, s * -0.15, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
    // Body.
    ctx.fillStyle = css(body);
    ctx.beginPath();
    ctx.ellipse(0, 0, r, r * 0.95, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // Tail fan, toward the camera (bottom).
    ctx.fillStyle = css(mix(body, [0, 0, 0], 0.3));
    for (const a of [-0.45, 0, 0.45]) {
      ctx.save();
      ctx.translate(0, r * 0.7);
      ctx.rotate(a);
      ctx.beginPath();
      ctx.ellipse(0, r * 0.3, r * 0.18, r * 0.42, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
    // Head (the back of it) with a crest.
    ctx.fillStyle = css(mix(body, [255, 255, 255], 0.08));
    ctx.beginPath();
    ctx.arc(0, -r * 0.85, r * 0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = css(mix(body, [0, 0, 0], 0.25));
    ctx.beginPath();
    ctx.moveTo(-r * 0.1, -r * 1.3);
    ctx.quadraticCurveTo(r * 0.05, -r * 1.7, r * 0.18, -r * 1.25);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // Charging: sweat drops; splatted: poop on its back.
    if (c > 0.5 && !crashed) {
      ctx.fillStyle = "#8fd8ff";
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.ellipse(s * r * 1.05, -r * 0.9 + Math.sin(this.time * 9) * 2, r * 0.1, r * 0.16, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    if (b.splatted > 0) drawSplat(ctx, 0, -r * 0.2, r * 0.75, b.id * 31 + 7, 1);
    ctx.restore();
    ctx.globalAlpha = 1;

    // Stars over a stunned or crashed bird.
    if (stunned || crashed) {
      for (let i = 0; i < 3; i++) {
        const a = this.time * 6 + (i * Math.PI * 2) / 3;
        ctx.fillStyle = "#ffd166";
        ctx.font = `${Math.round(Math.max(10, r * 0.6))}px system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.fillText("★", q.x + Math.cos(a) * r * 0.9, q.y - r * 1.5 + Math.sin(a) * r * 0.25);
      }
    }
    // The "1" / "2" tag, so the players never need the colours.
    const tagY = q.y - r * 2.05;
    ctx.font = `900 ${Math.round(Math.max(12, R * 0.75))}px Trebuchet MS, system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const tw = Math.max(18, R * 1.1);
    ctx.fillStyle = PLAYER_COLORS[b.id];
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.roundRect(q.x - tw / 2, tagY - tw * 0.42, tw, tw * 0.84, tw * 0.3);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#fff";
    ctx.fillText(String(b.id + 1), q.x, tagY + 1);
    // The winner's crown.
    if (duel.phase === "over" && duel.winner === b.id) this.drawCrown(q.x, tagY - tw * 0.95, tw * 1.1);
  }

  private drawCrown(x: number, y: number, w: number): void {
    const ctx = this.ctx;
    ctx.fillStyle = "#ffd166";
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(x - w / 2, y + w * 0.3);
    ctx.lineTo(x - w / 2, y - w * 0.15);
    ctx.lineTo(x - w / 4, y + w * 0.08);
    ctx.lineTo(x, y - w * 0.3);
    ctx.lineTo(x + w / 4, y + w * 0.08);
    ctx.lineTo(x + w / 2, y - w * 0.15);
    ctx.lineTo(x + w / 2, y + w * 0.3);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  // --- HUD ------------------------------------------------------------------------------

  private drawHud(view: DuelView): void {
    const ctx = this.ctx;
    const duel = view.duel;
    // Timer, top centre.
    const secs = Math.ceil(duel.phase === "countdown" ? duel.matchTime : duel.timeLeft);
    const text = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "900 34px Trebuchet MS, system-ui, sans-serif";
    ctx.lineWidth = 6;
    ctx.strokeStyle = OUTLINE;
    ctx.strokeText(text, this.width / 2, 30);
    ctx.fillStyle = duel.timeLeft <= 10 && duel.phase === "playing" ? "#ff6b6b" : "#fffaf0";
    ctx.fillText(text, this.width / 2, 30);
    for (const p of [0, 1] as const) this.drawPanel(view, p);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    if (view.toast) {
      ctx.font = "800 17px Trebuchet MS, system-ui, sans-serif";
      const w = Math.min(this.width - 40, ctx.measureText(view.toast).width + 28);
      ctx.fillStyle = "rgba(43,45,66,0.75)";
      ctx.beginPath();
      ctx.roundRect(this.width / 2 - w / 2, 54, w, 30, 15);
      ctx.fill();
      ctx.fillStyle = "#fffaf0";
      ctx.fillText(view.toast, this.width / 2, 70);
    }

    // 3-2-1-GO.
    let big: string | null = view.banner;
    if (!big && duel.phase === "countdown") big = String(Math.max(1, Math.ceil(duel.countdown)));
    else if (!big && duel.phase === "playing" && duel.playTime < 0.7) big = "GO!";
    else if (!big && duel.phase === "finishing") big = "TIME!";
    if (big) {
      // Over the street, below the birds, so it never hides them.
      ctx.font = "900 96px Trebuchet MS, system-ui, sans-serif";
      ctx.lineWidth = 12;
      ctx.strokeStyle = OUTLINE;
      ctx.strokeText(big, this.width / 2, VIEW_H * 0.66);
      ctx.fillStyle = "#ffd166";
      ctx.fillText(big, this.width / 2, VIEW_H * 0.66);
    }
  }

  /** A player's corner: live face, strain gauge, score, combo, charge. */
  private drawPanel(view: DuelView, p: PlayerId): void {
    const ctx = this.ctx;
    const duel = view.duel;
    const b = duel.birds[p];
    const hud = view.players[p];
    const w = Math.min(250, this.width * 0.3);
    const h = 92;
    const x = p === 0 ? 10 : this.width - w - 10;
    const y = 10;
    ctx.fillStyle = "rgba(255,250,240,0.88)";
    ctx.strokeStyle = PLAYER_COLORS[p];
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 16);
    ctx.fill();
    ctx.stroke();
    // Face (P1's at the outer left, P2's at the outer right).
    const fs = 72;
    const fx = p === 0 ? x + 10 : x + w - 10 - fs;
    const fy = y + 10;
    this.drawFace(view.video, hud, fx, fy, fs, p);
    // Strain gauge next to the face (face players), or the key.
    const gx = p === 0 ? fx + fs + 6 : fx - 18;
    if (hud.mode === "face") this.drawGauge(gx, fy, 12, fs, hud.strain, hud.strainActive, view.strainOn);
    // Score and the rest.
    const tx = p === 0 ? gx + 22 : gx - 10;
    ctx.textAlign = p === 0 ? "left" : "right";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = PLAYER_DARK[p];
    ctx.font = "900 15px Trebuchet MS, system-ui, sans-serif";
    ctx.fillText(`PLAYER ${p + 1}`, tx, y + 26);
    ctx.fillStyle = OUTLINE;
    ctx.font = "900 34px Trebuchet MS, system-ui, sans-serif";
    ctx.fillText(String(b.score), tx, y + 60);
    if (b.combo > 1) {
      ctx.font = "800 14px Trebuchet MS, system-ui, sans-serif";
      ctx.fillStyle = "#e85d04";
      ctx.fillText(`combo x${duel.comboMultiplier(b.combo).toFixed(1)}`, tx, y + 78);
    } else if (hud.mode === "keys") {
      ctx.font = "700 12px Trebuchet MS, system-ui, sans-serif";
      ctx.fillStyle = "#666";
      ctx.fillText(p === 0 ? "W squeeze · A D steer" : "↑ squeeze · ← → steer", tx, y + 78);
    }
    // Charge meter along the bottom.
    const mw = w - fs - 46;
    const mx = p === 0 ? tx : tx - mw;
    const my = y + h - 10;
    ctx.fillStyle = "rgba(43,45,66,0.2)";
    ctx.fillRect(mx, my, mw, 6);
    ctx.fillStyle = duel.sweetSpot(p) ? "#ffd000" : b.charge.charge >= 1 ? "#ef476f" : "#f78c3b";
    ctx.fillRect(p === 0 ? mx : mx + mw * (1 - b.charge.charge), my, mw * b.charge.charge, 6);
    // Tilt indicator: which way they're banking.
    if (Math.abs(hud.steer) > 0.02) {
      ctx.fillStyle = PLAYER_COLORS[p];
      const ax = fx + fs / 2 + hud.steer * (fs / 2 - 6);
      ctx.beginPath();
      ctx.moveTo(ax + Math.sign(hud.steer) * 8, fy + fs + 2);
      ctx.lineTo(ax - Math.sign(hud.steer) * 4, fy + fs - 4);
      ctx.lineTo(ax - Math.sign(hud.steer) * 4, fy + fs + 8);
      ctx.closePath();
      ctx.fill();
    }
  }

  /** The live face crop from the webcam (mirrored), or a placeholder. */
  private drawFace(video: HTMLVideoElement | null, hud: HudPlayer, x: number, y: number, size: number, p: PlayerId): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x, y, size, size, 12);
    ctx.clip();
    ctx.fillStyle = "#d9d4c7";
    ctx.fillRect(x, y, size, size);
    const box = hud.faceBox;
    const vw = video?.videoWidth ?? 0;
    const vh = video?.videoHeight ?? 0;
    if (hud.mode === "face" && box && video && vw && vh) {
      const side = Math.max(box.w * vw, box.h * vh) * 1.35;
      const cx = (box.x + box.w / 2) * vw;
      const cy = (box.y + box.h / 2) * vh;
      ctx.translate(x + size, y);
      ctx.scale(-1, 1);
      try {
        ctx.drawImage(video, cx - side / 2, cy - side / 2, side, side, 0, 0, size, size);
      } catch {
        // The video isn't drawable yet.
      }
    } else {
      ctx.fillStyle = PLAYER_COLORS[p];
      ctx.font = `900 ${Math.round(size * 0.55)}px Trebuchet MS, system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(hud.mode === "keys" ? "⌨" : "?", x + size / 2, y + size / 2 + 2);
    }
    ctx.restore();
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.roundRect(x, y, size, size, 12);
    ctx.stroke();
  }

  private drawGauge(x: number, y: number, w: number, h: number, value: number, active: boolean, line: number): void {
    const ctx = this.ctx;
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, w / 2);
    ctx.fill();
    ctx.stroke();
    const v = Math.max(0, Math.min(1, value));
    ctx.fillStyle = active ? "#ef476f" : "#8ac926";
    ctx.beginPath();
    ctx.roundRect(x + 2, y + 2 + (h - 4) * (1 - v), w - 4, (h - 4) * v, (w - 4) / 2);
    ctx.fill();
    const ly = y + h * (1 - line);
    ctx.fillStyle = OUTLINE;
    ctx.fillRect(x - 3, ly - 1.5, w + 6, 3);
    ctx.font = "13px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("💩", x + w / 2, ly - 9);
  }

  // --- seat check -------------------------------------------------------------------------

  drawSeats(view: SeatView, backdrop: Duel, dt: number): void {
    this.drawBackdrop(backdrop, dt);
    const ctx = this.ctx;
    ctx.fillStyle = "rgba(43,45,66,0.45)";
    ctx.fillRect(0, 0, this.width, VIEW_H);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "900 34px Trebuchet MS, system-ui, sans-serif";
    ctx.lineWidth = 6;
    ctx.strokeStyle = OUTLINE;
    ctx.strokeText("The Doo-el 💩", this.width / 2, 34);
    ctx.fillStyle = "#ffd166";
    ctx.fillText("The Doo-el 💩", this.width / 2, 34);

    // The camera image, mirrored, fitted into the area under the title.
    const areaW = Math.min(this.width - 40, 760);
    const areaH = 300;
    const vw = view.video?.videoWidth ?? 0;
    const vh = view.video?.videoHeight ?? 0;
    const aspect = vw && vh ? vw / vh : 4 / 3;
    const dh = Math.min(areaH, areaW / aspect);
    const dw = dh * aspect;
    const dx = (this.width - dw) / 2;
    const dy = 62;
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(dx, dy, dw, dh, 16);
    ctx.clip();
    ctx.fillStyle = "#3a3d55";
    ctx.fillRect(dx, dy, dw, dh);
    if (view.video && vw && vh) {
      ctx.save();
      ctx.translate(dx + dw, dy);
      ctx.scale(-1, 1);
      try {
        ctx.drawImage(view.video, 0, 0, vw, vh, 0, 0, dw, dh);
      } catch {
        // Not drawable yet.
      }
      ctx.restore();
    }
    // The two seats: halves of the mirrored image.
    for (const p of [0, 1] as const) {
      const seat = view.seats[p];
      const sx = dx + (p === 0 ? 0 : dw / 2);
      const color = seat.phase === "ready" || seat.phase === "keys" ? "#7ae582" : seat.phase === "empty" ? "rgba(255,255,255,0.6)" : PLAYER_COLORS[p];
      ctx.strokeStyle = color;
      ctx.lineWidth = 6;
      ctx.strokeRect(sx + 4, dy + 4, dw / 2 - 8, dh - 8);
      if (seat.box && vw) {
        const bx = dx + (1 - seat.box.x - seat.box.w) * dw;
        const by = dy + seat.box.y * dh;
        ctx.strokeStyle = PLAYER_COLORS[p];
        ctx.lineWidth = 3;
        ctx.strokeRect(bx, by, seat.box.w * dw, seat.box.h * dh);
      }
      if (seat.phase === "squeeze" || seat.phase === "ready") {
        const gx = p === 0 ? sx + 14 : sx + dw / 2 - 30;
        this.drawGauge(gx, dy + 40, 16, dh - 80, seat.strain, seat.strainActive, view.strainOn);
      }
      if (seat.phase === "reading") {
        ctx.fillStyle = "rgba(255,255,255,0.3)";
        ctx.fillRect(sx + 20, dy + dh - 18, dw / 2 - 40, 8);
        ctx.fillStyle = "#ffd166";
        ctx.fillRect(sx + 20, dy + dh - 18, (dw / 2 - 40) * Math.min(1, seat.progress), 8);
      }
    }
    // Midline.
    ctx.setLineDash([10, 8]);
    ctx.strokeStyle = "rgba(255,255,255,0.8)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(dx + dw / 2, dy);
    ctx.lineTo(dx + dw / 2, dy + dh);
    ctx.stroke();
    ctx.setLineDash([]);
    if (view.message) {
      ctx.fillStyle = "rgba(43,45,66,0.7)";
      ctx.fillRect(dx, dy + dh / 2 - 30, dw, 60);
      ctx.fillStyle = "#fffaf0";
      ctx.font = "800 20px Trebuchet MS, system-ui, sans-serif";
      this.wrapText(view.message, dx + dw / 2, dy + dh / 2, dw - 30, 24);
    }
    ctx.restore();
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.roundRect(dx, dy, dw, dh, 16);
    ctx.stroke();

    // A card per seat under the image.
    const cardY = dy + dh + 12;
    const cardH = 96;
    const cardW = Math.min(dw / 2 - 8, 340);
    for (const p of [0, 1] as const) {
      const seat = view.seats[p];
      const cx = p === 0 ? this.width / 2 - 8 - cardW : this.width / 2 + 8;
      ctx.fillStyle = "rgba(255,250,240,0.95)";
      ctx.strokeStyle = PLAYER_COLORS[p];
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.roundRect(cx, cardY, cardW, cardH, 16);
      ctx.fill();
      ctx.stroke();
      ctx.textAlign = "center";
      ctx.fillStyle = PLAYER_DARK[p];
      ctx.font = "900 14px Trebuchet MS, system-ui, sans-serif";
      ctx.fillText(`PLAYER ${p + 1} · ${p === 0 ? "LEFT" : "RIGHT"}`, cx + cardW / 2, cardY + 18);
      ctx.fillStyle = seat.phase === "ready" || seat.phase === "keys" ? "#3d7a0a" : OUTLINE;
      ctx.font = "900 21px Trebuchet MS, system-ui, sans-serif";
      ctx.fillText(seat.title, cx + cardW / 2, cardY + 44);
      ctx.fillStyle = "#555";
      ctx.font = "600 13px Trebuchet MS, system-ui, sans-serif";
      this.wrapText(seat.hint, cx + cardW / 2, cardY + 70, cardW - 20, 16);
    }
    if (view.debug) this.drawDebug(view.debug, view.video);
  }

  private wrapText(text: string, x: number, y: number, maxW: number, lineH: number): void {
    const ctx = this.ctx;
    const words = text.split(" ");
    const lines: string[] = [];
    let line = "";
    for (const w of words) {
      const next = line ? `${line} ${w}` : w;
      if (ctx.measureText(next).width > maxW && line) {
        lines.push(line);
        line = w;
      } else line = next;
    }
    if (line) lines.push(line);
    const top = y - ((lines.length - 1) * lineH) / 2;
    lines.forEach((l, i) => ctx.fillText(l, x, top + i * lineH));
  }

  // --- debug ---------------------------------------------------------------------------------

  /** A small webcam view with both players' crops, masks and locks, plus the identity numbers. */
  private drawDebug(d: DebugOverlay, video: HTMLVideoElement | null): void {
    const ctx = this.ctx;
    const w = 260;
    const vw = video?.videoWidth ?? 0;
    const vh = video?.videoHeight ?? 0;
    const h = vw && vh ? (w * vh) / vw : 195;
    // Bottom-right corner, with the text lines under the picture, all on screen.
    const x = this.width - w - 8;
    const y = VIEW_H - h - d.lines.length * 13 - 14;
    ctx.save();
    ctx.globalAlpha = 0.92;
    ctx.fillStyle = "#000";
    ctx.fillRect(x, y, w, h);
    if (video && vw && vh) {
      ctx.save();
      ctx.translate(x + w, y);
      ctx.scale(-1, 1);
      try {
        ctx.drawImage(video, 0, 0, vw, vh, 0, 0, w, h);
      } catch {
        // ignore
      }
      ctx.restore();
    }
    const rect = (b: FaceBox, color: string, dash: number[] = []) => {
      ctx.setLineDash(dash);
      ctx.strokeStyle = color;
      ctx.strokeRect(x + (1 - b.x - b.w) * w, y + b.y * h, b.w * w, b.h * h);
      ctx.setLineDash([]);
    };
    ctx.lineWidth = 1.5;
    d.seats.forEach((s, i) => {
      const color = PLAYER_COLORS[i];
      if (s.region) rect(s.region, color, [4, 3]);
      for (const m of s.masks) {
        ctx.fillStyle = "rgba(128,128,128,0.5)";
        ctx.fillRect(x + (1 - m.x - m.w) * w, y + m.y * h, m.w * w, m.h * h);
      }
      if (s.lock) {
        ctx.lineWidth = 2.5;
        rect(s.lock, color);
        ctx.lineWidth = 1.5;
        ctx.fillStyle = color;
        ctx.font = "800 11px system-ui, sans-serif";
        ctx.textAlign = "left";
        ctx.fillText(`P${i + 1} ${s.status}`, x + (1 - s.lock.x - s.lock.w) * w, y + s.lock.y * h - 4);
      }
    });
    const lh = 13;
    ctx.font = "11px ui-monospace, monospace";
    const textW = Math.max(w, ...d.lines.map((l) => ctx.measureText(l).width + 8));
    const tx = Math.max(0, this.width - textW - 8);
    ctx.fillStyle = "rgba(0,0,0,0.7)";
    ctx.fillRect(tx, y + h, textW, d.lines.length * lh + 6);
    ctx.fillStyle = "#fff";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    d.lines.forEach((l, i) => ctx.fillText(l, tx + 4, y + h + 3 + i * lh));
    ctx.restore();
  }
}

/** The next gate ahead of the bird within ~1.2 s, if any (for the pass/hit ring). */
function nextGate(duel: Duel, b: DuelBird): Gate | null {
  if (b.state !== "flying" || duel.phase !== "playing") return null;
  let best: Gate | null = null;
  for (const g of duel.gates) {
    if (g.ghost || g.kind === "finish" || g.z < duel.z || g.z - duel.z > duel.speed * 1.2) continue;
    if (!best || g.z < best.z) best = g;
  }
  return best;
}
