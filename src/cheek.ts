// Cheek outline experiment (cheek.html, dev server only; not part of the
// build). A scripted ~95 s session: a relaxed reference, plain puffs, pulses,
// looking around, straining, the pufferfish face and talking. Per frame it
// measures the face's silhouette on probe lines through the cheeks
// (outline.ts) next to what the mesh and the blendshapes say, then scores how
// well each signal separates puffing from everything else. Nothing leaves
// the tab; only numbers can be downloaded.

import { FaceTracker, describeCameraError, type FaceFrame } from "./face";
import {
  CHEEK_PROBES,
  PATCH_ANCHORS,
  auc,
  faceAxes,
  fromFace,
  measureOutline,
  median,
  meshProbes,
  ncc,
  patchVector,
  toFace,
  DEFAULT_EDGE,
  type FaceAxes,
  type OutlineMeasure,
  type Probe,
  type RgbaImage,
} from "./outline";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

// --- Script ----------------------------------------------------------------------

interface Step {
  label: string;
  prompt: string;
  seconds: number;
  /** High beep for an active face, low for relaxing. */
  active: boolean;
}

const step = (label: string, prompt: string, seconds: number, active = false): Step => ({ label, prompt, seconds, active });

const SCRIPT: Step[] = [
  step("ready", "Get ready: relax, look at the screen", 3),
  step("neutral", "Relax your face (reference)", 5),
  step("puff", "Puff your cheeks, lips closed (not pursed). Hold", 5, true),
  step("relax", "Relax", 3),
  step("puff", "Puff your cheeks again. Hold", 5, true),
  step("relax", "Relax", 3),
  ...[1, 2, 3, 4].flatMap(() => [step("puffPulse", "Puff", 2.5, true), step("puffRelax", "Relax", 2.5)]),
  step("look", "Stay relaxed and look around the screen corners", 6),
  step("lookPuff", "Puff and hold while looking around", 5, true),
  step("relax", "Relax", 3),
  step("strain", "STRAIN! (brows down, eyes squeezed)", 4, true),
  step("relax", "Relax", 3),
  step("fish", "Pufferfish face: puff + purse your lips. Hold", 5, true),
  step("relax", "Relax", 3),
  step("talk", "Smile, talk, laugh", 6),
  step("relax", "Relax", 3),
];

/** Within the neutral step: the mesh places the probes first, then the image edges are read on them. */
const REF_PROBES_FROM = 0.8;
const REF_EDGES_FROM = 2.3;
/** Frames this soon after a cue are reaction time and aren't scored. */
const REACTION = 0.6;
/** Cheek patch side, in eye distances. */
const PATCH_SIZE = 0.3;

// --- State -------------------------------------------------------------------------

interface Reference {
  probes: Probe[];
  width: number[];
  meshWidth: number[];
  patches: { u: number; v: number; ref: Float64Array }[];
}

interface Row {
  t: number;
  label: string;
  since: number;
  /** Image outline width minus the reference, mean over the cheek probes (eye distances). */
  outline: number;
  /** Per probe, cheekbone to jaw. */
  outlineProbe: number[];
  /** Image edge offsets per side, mean over the cheek probes (outward positive). */
  outlineLeft: number;
  outlineRight: number;
  /** The mesh's outline width at the same anchors, minus its reference. */
  meshWidth: number;
  /** 1 − correlation of the cheek patches with the relaxed ones. */
  shading: number;
  edgeStrength: number;
  mouthPucker: number;
  mouthPress: number;
  cheekPuff: number;
  cheekWidth: number;
  eyeMouth: number;
}

const video = document.createElement("video");
video.muted = true;
video.playsInline = true;
// In the document (but invisible) so every browser keeps decoding it; the canvas shows it.
video.style.cssText = "position:fixed;width:1px;height:1px;opacity:0;pointer-events:none";
document.body.append(video);
const tracker = new FaceTracker(video);
const view = $<HTMLCanvasElement>("view");
const viewCtx = view.getContext("2d")!;
const plot = $<HTMLCanvasElement>("plot");
const plotCtx = plot.getContext("2d")!;
const grab = document.createElement("canvas");
const grabCtx = grab.getContext("2d", { willReadFrequently: true })!;

let running = false;
let scriptStart = 0;
let reference: Reference | null = null;
let refProbeFrames: Probe[][] = [];
let refEdgeFrames: { m: OutlineMeasure; mesh: number[]; patches: (Float64Array | null)[] }[] = [];
let refPatchCentres: { u: number; v: number }[][] = [];
let rows: Row[] = [];
let lastOverlay: { f: FaceAxes; probes: Probe[]; m: OutlineMeasure | null; mesh: Probe[]; patches: { u: number; v: number }[] } | null = null;
const history: { t: number; outline: number; mesh: number; shading: number; pucker: number; active: boolean }[] = [];

// --- Sound ----------------------------------------------------------------------------

let audio: AudioContext | null = null;
function beep(high: boolean): void {
  if (!audio) return;
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.frequency.value = high ? 880 : 440;
  gain.gain.setValueAtTime(0.15, audio.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.18);
  osc.connect(gain).connect(audio.destination);
  osc.start();
  osc.stop(audio.currentTime + 0.2);
}

// --- Script clock ---------------------------------------------------------------------

function stepAt(elapsed: number): { index: number; since: number } | null {
  let start = 0;
  for (let i = 0; i < SCRIPT.length; i++) {
    if (elapsed < start + SCRIPT[i].seconds) return { index: i, since: elapsed - start };
    start += SCRIPT[i].seconds;
  }
  return null;
}

const TOTAL = SCRIPT.reduce((s, x) => s + x.seconds, 0);
let lastStepIndex = -1;

function tickScript(now: number): void {
  if (!running) return;
  const at = stepAt((now - scriptStart) / 1000);
  if (!at) {
    finishScript();
    return;
  }
  if (at.index !== lastStepIndex) {
    lastStepIndex = at.index;
    const s = SCRIPT[at.index];
    $("prompt").textContent = s.prompt;
    $("prompt").classList.toggle("active", s.active);
    beep(s.active);
    if (s.label !== "neutral" && SCRIPT[at.index - 1]?.label === "neutral") freezeReference();
  }
  $("progress").style.width = `${((now - scriptStart) / 1000 / TOTAL) * 100}%`;
}

function startScript(): void {
  audio ??= new AudioContext();
  void audio.resume();
  rows = [];
  reference = null;
  refProbeFrames = [];
  refEdgeFrames = [];
  refPatchCentres = [];
  lastStepIndex = -1;
  running = true;
  scriptStart = performance.now();
  $<HTMLButtonElement>("btn-start").disabled = true;
  $<HTMLButtonElement>("btn-download").disabled = true;
  $("results").hidden = true;
}

function finishScript(): void {
  running = false;
  $("prompt").textContent = "Done";
  $("prompt").classList.remove("active");
  $("progress").style.width = "100%";
  $<HTMLButtonElement>("btn-start").disabled = false;
  $<HTMLButtonElement>("btn-download").disabled = rows.length === 0;
  showResults();
}

// --- Reference -----------------------------------------------------------------------

function medianProbes(frames: Probe[][]): Probe[] {
  return frames[0].map((_, k) => ({
    v: median(frames.map((p) => p[k].v)),
    uLeft: median(frames.map((p) => p[k].uLeft)),
    uRight: median(frames.map((p) => p[k].uRight)),
  }));
}

/** Probe lines from the mesh during the first part of the neutral step, the expected edges from the image in the rest. */
function freezeReference(): void {
  if (refEdgeFrames.length < 8) {
    $("status").textContent = "Couldn't see your face well during the reference. Press start to try again.";
    running = false;
    $<HTMLButtonElement>("btn-start").disabled = false;
    return;
  }
  const probes = medianProbes(refProbeFrames);
  const k = probes.length;
  const edgeProbes: Probe[] = probes.map((p, i) => ({
    v: p.v,
    uLeft: median(refEdgeFrames.map((r) => r.m.left[i]?.u ?? NaN)),
    uRight: median(refEdgeFrames.map((r) => r.m.right[i]?.u ?? NaN)),
  }));
  const width = Array.from({ length: k }, (_, i) => median(refEdgeFrames.map((r) => r.m.width[i])));
  const meshWidth = Array.from({ length: k }, (_, i) => median(refEdgeFrames.map((r) => r.mesh[i])));
  const centres = PATCH_ANCHORS.map((_, side) => ({
    u: median(refPatchCentres.map((c) => c[side].u)),
    v: median(refPatchCentres.map((c) => c[side].v)),
  }));
  const patches = centres.map((c, side) => {
    const sum = new Float64Array(144);
    for (const r of refEdgeFrames) {
      const p = r.patches[side];
      if (p) for (let i = 0; i < sum.length; i++) sum[i] += p[i];
    }
    let norm = 0;
    for (const x of sum) norm += x * x;
    norm = Math.sqrt(norm) || 1;
    return { ...c, ref: sum.map((x) => x / norm) };
  });
  reference = {
    probes: edgeProbes.map((p, i) => ({
      v: p.v,
      uLeft: Number.isFinite(p.uLeft) ? p.uLeft : probes[i].uLeft,
      uRight: Number.isFinite(p.uRight) ? p.uRight : probes[i].uRight,
    })),
    width,
    meshWidth,
    patches,
  };
  $("status").textContent = "Reference taken. Follow the prompts.";
}

// --- Per frame ----------------------------------------------------------------------

function grabImage(): RgbaImage | null {
  const w = video.videoWidth;
  const h = video.videoHeight;
  if (!w || !h) return null;
  if (grab.width !== w || grab.height !== h) {
    grab.width = w;
    grab.height = h;
  }
  grabCtx.drawImage(video, 0, 0, w, h);
  return grabCtx.getImageData(0, 0, w, h);
}

const mean = (v: number[]) => {
  const ok = v.filter(Number.isFinite);
  return ok.length ? ok.reduce((a, b) => a + b, 0) / ok.length : NaN;
};

function onFace(frame: FaceFrame): void {
  const lm = frame.landmarks;
  if (!lm || !frame.features) return;
  const img = grabImage();
  if (!img) return;
  const f = faceAxes(lm, img.width, img.height);
  if (!f) return;
  const mesh = meshProbes(lm, f, img.width, img.height);
  const meshW = mesh.map((p) => p.uRight - p.uLeft);
  const patchCentres = PATCH_ANCHORS.map((i) => toFace(f, { x: lm[i].x * img.width, y: lm[i].y * img.height }));

  const now = performance.now();
  const at = running ? stepAt((now - scriptStart) / 1000) : null;
  const label = at ? SCRIPT[at.index].label : "";

  // Reference collection.
  if (at && label === "neutral" && !reference) {
    if (at.since >= REF_PROBES_FROM && at.since < REF_EDGES_FROM) {
      refProbeFrames.push(mesh);
      refPatchCentres.push(patchCentres);
    } else if (at.since >= REF_EDGES_FROM && refProbeFrames.length) {
      const probes = medianProbes(refProbeFrames);
      const centres = PATCH_ANCHORS.map((_, side) => ({
        u: median(refPatchCentres.map((c) => c[side].u)),
        v: median(refPatchCentres.map((c) => c[side].v)),
      }));
      const m = measureOutline(img, f, probes);
      refEdgeFrames.push({ m, mesh: meshW, patches: centres.map((c) => patchVector(img, f, c.u, c.v, PATCH_SIZE)) });
      lastOverlay = { f, probes, m, mesh, patches: centres };
    } else {
      lastOverlay = { f, probes: mesh, m: null, mesh, patches: patchCentres };
    }
    return;
  }
  if (!reference) {
    lastOverlay = { f, probes: mesh, m: measureOutline(img, f, mesh), mesh, patches: patchCentres };
    return;
  }

  const m = measureOutline(img, f, reference.probes);
  const delta = m.width.map((w, i) => w - reference!.width[i]);
  const cheek = (v: number[]) => mean(CHEEK_PROBES.map((i) => v[i]));
  const outward = (side: "left" | "right") =>
    cheek(reference!.probes.map((p, i) => {
      const e = m[side][i];
      return e ? (side === "left" ? p.uLeft - e.u : e.u - p.uRight) : NaN;
    }));
  const shading = mean(
    reference.patches.map((p) => {
      const cur = patchVector(img, f, p.u, p.v, PATCH_SIZE);
      return cur ? 1 - ncc(cur, p.ref) : NaN;
    }),
  );
  const strength = Math.min(...CHEEK_PROBES.flatMap((i) => [m.left[i]?.strength ?? 0, m.right[i]?.strength ?? 0]));
  const row: Row = {
    t: (now - scriptStart) / 1000,
    label,
    since: at?.since ?? 0,
    outline: cheek(delta),
    outlineProbe: delta,
    outlineLeft: outward("left"),
    outlineRight: outward("right"),
    meshWidth: cheek(meshW.map((w, i) => w - reference!.meshWidth[i])),
    shading,
    edgeStrength: strength,
    mouthPucker: frame.blendshapes.mouthPucker ?? 0,
    mouthPress: frame.features.mouthPress,
    cheekPuff: frame.blendshapes.cheekPuff ?? 0,
    cheekWidth: frame.features.cheekWidth,
    eyeMouth: frame.features.eyeMouth,
  };
  if (running && at) rows.push(row);
  lastOverlay = { f, probes: reference.probes, m, mesh, patches: reference.patches };
  history.push({ t: now / 1000, outline: row.outline, mesh: row.meshWidth, shading: row.shading, pucker: row.mouthPucker, active: !!at && SCRIPT[at.index].active });
  while (history.length && now / 1000 - history[0].t > 15) history.shift();
  $("live").textContent =
    `outline ${(row.outline * 100).toFixed(1)}% · mesh ${(row.meshWidth * 100).toFixed(1)}% · ` +
    `shading ${row.shading.toFixed(3)} · pucker ${row.mouthPucker.toFixed(2)} · edge strength ${strength.toFixed(0)}`;
}

tracker.onFrame(onFace);

// --- Drawing -----------------------------------------------------------------------

function drawView(): void {
  const w = video.videoWidth;
  const h = video.videoHeight;
  if (w && h) {
    if (view.width !== w || view.height !== h) {
      view.width = w;
      view.height = h;
    }
    viewCtx.drawImage(video, 0, 0, w, h);
    const o = lastOverlay;
    if (o) {
      const dot = (u: number, v: number, color: string, r: number) => {
        const p = fromFace(o.f, u, v);
        viewCtx.fillStyle = color;
        viewCtx.beginPath();
        viewCtx.arc(p.x, p.y, r, 0, Math.PI * 2);
        viewCtx.fill();
      };
      viewCtx.lineWidth = 1;
      viewCtx.strokeStyle = "rgba(200,200,200,0.7)";
      for (const p of o.probes) {
        for (const u of [p.uLeft, p.uRight]) {
          const a = fromFace(o.f, u - DEFAULT_EDGE.halfWidth, p.v);
          const b = fromFace(o.f, u + DEFAULT_EDGE.halfWidth, p.v);
          viewCtx.beginPath();
          viewCtx.moveTo(a.x, a.y);
          viewCtx.lineTo(b.x, b.y);
          viewCtx.stroke();
        }
      }
      for (const p of o.mesh) {
        dot(p.uLeft, p.v, "#3a86ff", 2.5);
        dot(p.uRight, p.v, "#3a86ff", 2.5);
      }
      if (o.m) {
        o.probes.forEach((p, i) => {
          for (const e of [o.m!.left[i], o.m!.right[i]]) if (e) dot(e.u, p.v, "#3ddc84", 3.5);
        });
      }
      viewCtx.strokeStyle = "#ffca3a";
      for (const c of o.patches) {
        const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => fromFace(o.f, c.u + (a * PATCH_SIZE) / 2, c.v + (b * PATCH_SIZE) / 2));
        viewCtx.beginPath();
        corners.forEach((q, i) => (i ? viewCtx.lineTo(q.x, q.y) : viewCtx.moveTo(q.x, q.y)));
        viewCtx.closePath();
        viewCtx.stroke();
      }
    }
  }
  drawPlot();
  tickScript(performance.now());
  requestAnimationFrame(drawView);
}

function drawPlot(): void {
  const W = plot.width;
  const H = plot.height;
  plotCtx.clearRect(0, 0, W, H);
  if (!history.length) return;
  const t1 = history[history.length - 1].t;
  const x = (t: number) => W - ((t1 - t) / 15) * W;
  // y: −4 % … +12 % of the eye distance for widths; shading × 100; pucker × 12.
  const y = (v: number) => H - ((v + 4) / 16) * H;
  for (const h of history) {
    if (h.active) {
      plotCtx.fillStyle = "rgba(239,71,111,0.08)";
      plotCtx.fillRect(x(h.t) - 2, 0, 4, H);
    }
  }
  plotCtx.strokeStyle = "rgba(128,128,128,0.5)";
  plotCtx.beginPath();
  plotCtx.moveTo(0, y(0));
  plotCtx.lineTo(W, y(0));
  plotCtx.stroke();
  const line = (get: (h: (typeof history)[number]) => number, color: string) => {
    plotCtx.strokeStyle = color;
    plotCtx.lineWidth = 2;
    plotCtx.beginPath();
    let started = false;
    for (const h of history) {
      const v = get(h);
      if (!Number.isFinite(v)) continue;
      if (started) plotCtx.lineTo(x(h.t), y(v));
      else plotCtx.moveTo(x(h.t), y(v));
      started = true;
    }
    plotCtx.stroke();
  };
  line((h) => h.outline * 100, "#ef476f");
  line((h) => h.mesh * 100, "#3a86ff");
  line((h) => h.shading * 100, "#3ddc84");
  line((h) => h.pucker * 12, "#ffca3a");
}

// --- Results -------------------------------------------------------------------------

const SIGNALS: { key: keyof Row; name: string }[] = [
  { key: "outline", name: "image outline width (cheek probes)" },
  { key: "outlineLeft", name: "image outline, image-left side" },
  { key: "outlineRight", name: "image outline, image-right side" },
  { key: "meshWidth", name: "mesh outline width (same probes)" },
  { key: "shading", name: "cheek shading change" },
  { key: "cheekWidth", name: "game: cheekWidth (mesh)" },
  { key: "eyeMouth", name: "game: eyeMouth (mesh)" },
  { key: "mouthPress", name: "blendshape: mouthPress" },
  { key: "mouthPucker", name: "blendshape: mouthPucker" },
  { key: "cheekPuff", name: "blendshape: cheekPuff" },
];

const PUFF = ["puff", "puffPulse"];
const RELAXED = ["relax", "puffRelax"];

function showResults(): void {
  const scored = rows.filter((r) => r.since >= REACTION);
  const pick = (labels: string[], key: keyof Row) => scored.filter((r) => labels.includes(r.label)).map((r) => r[key] as number);
  const cell = (a: number) => {
    const cls = a >= 0.8 ? "good" : a < 0.65 ? "bad" : "";
    return `<td class="${cls}">${Number.isFinite(a) ? a.toFixed(2) : "–"}</td>`;
  };
  const head = ["signal", "effect", "puff vs relaxed", "vs looking around", "puff while looking vs looking", "vs straining", "vs talking", "pufferfish face vs relaxed"];
  let html = `<table><tr>${head.map((h) => `<th>${h}</th>`).join("")}</tr>`;
  for (const s of SIGNALS) {
    const puff = pick(PUFF, s.key);
    const relaxed = pick(RELAXED, s.key);
    const dir = median(puff) >= median(relaxed) ? 1 : -1;
    const o = (v: number[]) => v.map((x) => x * dir);
    const jitter = 1.4826 * median(relaxed.map((x) => Math.abs(x - median(relaxed))));
    const effect = (median(puff) - median(relaxed)) / (jitter || NaN);
    html +=
      `<tr><td>${s.name} ${dir > 0 ? "↑" : "↓"}</td><td>${Number.isFinite(effect) ? effect.toFixed(1) : "–"}</td>` +
      cell(auc(o(relaxed), o(puff))) +
      cell(auc(o(pick(["look"], s.key)), o(puff))) +
      cell(auc(o(pick(["look"], s.key)), o(pick(["lookPuff"], s.key)))) +
      cell(auc(o(pick(["strain"], s.key)), o(puff))) +
      cell(auc(o(pick(["talk"], s.key)), o(puff))) +
      cell(auc(o(relaxed), o(pick(["fish"], s.key)))) +
      "</tr>";
  }
  html += "</table>";
  const perProbe = [0, 1, 2, 3, 4].map((i) => {
    const puff = scored.filter((r) => PUFF.includes(r.label)).map((r) => r.outlineProbe[i]);
    const relaxed = scored.filter((r) => RELAXED.includes(r.label)).map((r) => r.outlineProbe[i]);
    return `${["cheekbone", "upper cheek", "mid cheek", "lower cheek", "jaw"][i]}: ${((median(puff) - median(relaxed)) * 100).toFixed(1)}% (AUC ${auc(relaxed, puff).toFixed(2)})`;
  });
  html += `<p class="muted">Image outline change per probe while puffing (% of eye distance, ~1% ≈ 1 mm): ${perProbe.join(" · ")}</p>`;
  $("results-table").innerHTML = html;
  $("results").hidden = false;
}

function download(): void {
  const data = {
    kind: "poopbird-cheek-outline",
    recordedAt: new Date().toISOString(),
    video: { width: video.videoWidth, height: video.videoHeight },
    script: SCRIPT,
    reference: reference && {
      probes: reference.probes,
      width: reference.width,
      meshWidth: reference.meshWidth,
      patchCentres: reference.patches.map((p) => ({ u: p.u, v: p.v })),
    },
    rows,
  };
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: "application/json" }));
  a.download = `cheek-outline-${data.recordedAt.replace(/[:.]/g, "-")}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

// --- Start -----------------------------------------------------------------------

$("btn-start").addEventListener("click", startScript);
$("btn-download").addEventListener("click", download);

async function init(): Promise<void> {
  try {
    await Promise.all([tracker.loadModel(), tracker.startCamera()]);
    tracker.start();
    $("status").textContent = `Camera ${video.videoWidth}×${video.videoHeight}. Check the green dots sit on your cheek outline, then start.`;
    $<HTMLButtonElement>("btn-start").disabled = false;
  } catch (err) {
    $("status").textContent = describeCameraError(err);
  }
  requestAnimationFrame(drawView);
}

void init();
