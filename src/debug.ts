// Debug / tuning panel (toggle with D). Shows live signals and a slider for
// every tunable in config.ts.

import { CONFIG_SPEC, config, defaultConfig, resetConfig, setConfigValue, type ConfigKey } from "./config";
import type { RecorderKind } from "./recorder";
import {
  FEATURE_NAMES,
  GEOMETRY_FEATURE_NAMES,
  PUFF_FEATURES,
  STRAIN_FEATURES,
  type Calibration,
  type FeatureName,
  type FeatureVector,
} from "./strain";

export interface DebugData {
  fps: number;
  detectionRate: number;
  delegate: string;
  mode: string;
  faceVisible: boolean;
  features: FeatureVector | null;
  calibration: Calibration | null;
  rawStrain: number;
  strain: number;
  strainActive: boolean;
  straining: boolean;
  charge: number;
  fullHold: number;
  stun: number;
  scrollSpeed: number;
  difficulty: number;
  birdVy: number;
  /** "city", "ocean", or a transition like "city → ocean". */
  stage: string;
  puffCalibration: Calibration | null;
  /** "calibrated (cheek width, …)" or "fallback range". */
  puffSource: string;
  rawPuff: number;
  facePuff: number;
  keyPuff: number;
  puffInput: number;
  fishPuff: number;
  spiked: boolean;
  spikeHold: number;
  puffStun: number;
}

const HISTORY = 300;

export class DebugPanel {
  readonly el: HTMLElement;
  private statsEl!: HTMLElement;
  private plot!: HTMLCanvasElement;
  private featureRows = new Map<string, { row: HTMLElement; v: HTMLElement; n: HTMLElement; s: HTMLElement; w: HTMLElement }>();
  private sliders = new Map<ConfigKey, { range: HTMLInputElement; num: HTMLInputElement; wrap: HTMLElement }>();
  private chargeFill!: HTMLElement;
  private history: { raw: number; strain: number; active: boolean; charge: number }[] = [];
  private puffHistory: { raw: number; face: number; input: number; spiked: boolean }[] = [];
  private puffPlot!: HTMLCanvasElement;
  private puffSection!: HTMLElement;
  private lastText = 0;
  private recordEl!: HTMLElement;
  visible = false;

  constructor(
    el: HTMLElement,
    private onRecalibrate: () => void,
    private onStartOcean: () => void,
    private onRecordFace: (kind: RecorderKind) => void,
    private onForgetCalibration: () => void,
  ) {
    this.el = el;
    this.build();
  }

  /** Big instruction line for the face recorder; null hides it. */
  setRecordPrompt(text: string | null): void {
    this.recordEl.textContent = text ?? "";
    this.recordEl.classList.toggle("hidden", text === null);
  }

  toggle(): void {
    this.visible = !this.visible;
    this.el.classList.toggle("hidden", !this.visible);
    document.body.classList.toggle("debug-open", this.visible);
  }

  private build(): void {
    const el = this.el;
    el.innerHTML = "";
    // Shortcut buttons first, so they don't need scrolling past the sliders.
    const quick = div("dbg-buttons");
    quick.append(button("🐡 Start as pufferfish (O)", () => this.onStartOcean()));
    quick.append(button("⏺ Record strain clip", () => this.onRecordFace("strain")));
    quick.append(button("⏺ Record puff clip", () => this.onRecordFace("puff")));
    quick.append(button("🗑 Forget calibration", () => this.onForgetCalibration()));
    el.append(quick);
    this.recordEl = div("dbg-record hidden");
    el.append(this.recordEl);
    el.append(h3("Stats"));
    this.statsEl = div("dbg-stats");
    el.append(this.statsEl);

    el.append(h3("Strain"));
    this.plot = document.createElement("canvas");
    this.plot.className = "dbg-plot";
    this.plot.width = 640;
    this.plot.height = 220;
    el.append(this.plot);
    const legend = div("dbg-legend");
    legend.innerHTML =
      '<i style="background:#ffd166"></i>strain <i style="background:#666"></i>raw <i style="background:#ef476f"></i>on <i style="background:#3a86ff"></i>off <i style="background:#8ac926"></i>charge';
    el.append(legend);

    const chargeWrap = div("dbg-feature");
    chargeWrap.innerHTML = "<span>charge</span>";
    const bar = div("dbg-fbar");
    this.chargeFill = div("v");
    this.chargeFill.style.background = "#8ac926";
    bar.append(this.chargeFill);
    chargeWrap.append(bar, span(""));
    el.append(chargeWrap);

    // Puff (ocean only)
    this.puffSection = div("dbg-puff");
    this.puffSection.append(h3("Puff"));
    this.puffPlot = document.createElement("canvas");
    this.puffPlot.className = "dbg-plot";
    this.puffPlot.width = 640;
    this.puffPlot.height = 180;
    this.puffSection.append(this.puffPlot);
    const puffLegend = div("dbg-legend");
    puffLegend.innerHTML =
      '<i style="background:#ffd166"></i>face (EMA) <i style="background:#666"></i>raw <i style="background:#4cc9f0"></i>input <i style="background:#3a86ff"></i>hover <i style="background:#ef476f"></i>spike';
    this.puffSection.append(puffLegend);
    el.append(this.puffSection);

    const keys = div("dbg-legend");
    keys.textContent = "With this panel open: G spawns the next gate, L a power line, F a paparazzo, O starts a run as the pufferfish";
    el.append(keys);

    el.append(h3("Face features (value · neutral | strain/puff · weight)"));
    for (const f of FEATURE_NAMES) {
      const row = div("dbg-feature");
      const fbar = div("dbg-fbar");
      const v = div("v");
      const n = div("n");
      const s = div("s");
      fbar.append(v, n, s);
      const w = span("–");
      w.className = "dbg-w";
      row.append(span(f), fbar, w);
      el.append(row);
      this.featureRows.set(f, { row, v, n, s, w });
    }

    // Sliders grouped by config group
    let group = "";
    for (const key of Object.keys(CONFIG_SPEC) as ConfigKey[]) {
      const spec = CONFIG_SPEC[key];
      if (spec.group !== group) {
        group = spec.group;
        el.append(h3(`Tune: ${group}`));
      }
      const wrap = div("dbg-slider");
      const label = document.createElement("label");
      label.innerHTML = `<span>${spec.label}</span><small>${"hint" in spec ? spec.hint : ""}</small>`;
      label.title = key;
      const range = document.createElement("input");
      range.type = "range";
      range.min = String(spec.min);
      range.max = String(spec.max);
      range.step = String(spec.step);
      const num = document.createElement("input");
      num.type = "number";
      num.min = String(spec.min);
      num.max = String(spec.max);
      num.step = String(spec.step);
      const apply = (value: number) => {
        if (!Number.isFinite(value)) return;
        setConfigValue(key, value);
        this.syncSlider(key);
      };
      range.addEventListener("input", () => apply(Number(range.value)));
      num.addEventListener("change", () => apply(Number(num.value)));
      // Keep keyboard shortcuts (Space, D, ...) from firing while using the panel.
      for (const inp of [range, num]) inp.addEventListener("keydown", (e) => e.stopPropagation());
      wrap.append(label, range, num);
      el.append(wrap);
      this.sliders.set(key, { range, num, wrap });
      this.syncSlider(key);
    }

    const buttons = div("dbg-buttons");
    const reset = button("Reset to defaults", () => {
      resetConfig();
      for (const key of this.sliders.keys()) this.syncSlider(key);
    });
    const copy = button("Copy config JSON", () => {
      const json = JSON.stringify(config, null, 2);
      void navigator.clipboard?.writeText(json).catch(() => console.log(json));
      console.log("[config]", json);
    });
    const recal = button("Recalibrate (C)", () => this.onRecalibrate());
    buttons.append(reset, copy, recal);
    el.append(buttons);
  }

  private syncSlider(key: ConfigKey): void {
    const s = this.sliders.get(key);
    if (!s) return;
    const v = config[key];
    s.range.value = String(v);
    if (document.activeElement !== s.num) s.num.value = String(Number(v.toFixed(4)));
    s.wrap.classList.toggle("changed", v !== defaultConfig()[key]);
  }

  update(d: DebugData): void {
    this.history.push({ raw: d.rawStrain, strain: d.strain, active: d.straining, charge: d.charge });
    if (this.history.length > HISTORY) this.history.shift();
    this.puffHistory.push({ raw: d.rawPuff, face: d.facePuff, input: d.puffInput, spiked: d.spiked });
    if (this.puffHistory.length > HISTORY) this.puffHistory.shift();
    if (!this.visible) return;
    this.drawPlot();
    const ocean = d.stage.includes("ocean");
    this.puffSection.classList.toggle("hidden", !ocean);
    if (ocean) this.drawPuffPlot();
    this.chargeFill.style.width = `${d.charge * 100}%`;
    this.chargeFill.style.background = d.stun > 0 ? "#7a4a1e" : d.charge >= 1 ? "#ff595e" : "#8ac926";

    const now = performance.now();
    if (now - this.lastText < 100) return;
    this.lastText = now;

    const stats: [string, string][] = [
      ["stage", d.stage],
      ["mode", d.mode],
      ["fps", d.fps.toFixed(0)],
      ["detections/s", d.detectionRate.toFixed(0)],
      ["delegate", d.delegate],
      ["face", d.faceVisible ? "yes" : "NO"],
      ["raw strain", d.rawStrain.toFixed(3)],
      ["strain (EMA)", d.strain.toFixed(3)],
      ["face active", d.strainActive ? "ON" : "off"],
      ["straining (any input)", d.straining ? "ON" : "off"],
      ["charge", d.charge.toFixed(2)],
      ["full hold", `${d.fullHold.toFixed(2)} / ${config.overstrainTime.toFixed(2)} s`],
      ["stun", d.stun.toFixed(2)],
      ["bird vy", d.birdVy.toFixed(0)],
      ["scroll", d.scrollSpeed.toFixed(0)],
      ["difficulty", d.difficulty.toFixed(2)],
      ["puff source", d.puffSource],
      ["puff raw / face", `${d.rawPuff.toFixed(3)} / ${d.facePuff.toFixed(3)}`],
      ["puff key / input", `${d.keyPuff.toFixed(2)} / ${d.puffInput.toFixed(2)}`],
      ["fish puff", d.fishPuff.toFixed(2)],
      ["spiked", d.spiked ? `YES ${d.spikeHold.toFixed(2)} / ${config.oceanSpikeMaxHold.toFixed(2)} s` : "no"],
      ["pop stun", d.puffStun.toFixed(2)],
    ];
    this.statsEl.innerHTML = stats.map(([k, v]) => `<span>${k}</span><span>${v}</span>`).join("");

    // Puff candidates show the puff calibration's markers and weights; the rest show strain's.
    // Features both use (mouth press/roll) follow the stage.
    const usesPuff = (f: FeatureName) => PUFF_FEATURES.includes(f) && (ocean || !STRAIN_FEATURES.includes(f));
    const calFor = (f: FeatureName) => (usesPuff(f) ? d.puffCalibration : d.calibration);
    const sums = new Map<Calibration, { max: number; sum: number }>();
    for (const c of [d.calibration, d.puffCalibration]) {
      if (!c) continue;
      const own = FEATURE_NAMES.filter((f) => calFor(f) === c);
      sums.set(c, {
        max: Math.max(1e-6, ...own.map((f) => c.weights[f])),
        sum: own.reduce((s, f) => s + c.weights[f], 0),
      });
    }
    for (const f of FEATURE_NAMES) {
      const r = this.featureRows.get(f)!;
      const val = d.features ? d.features[f] : 0;
      const cal = calFor(f);
      const { max: maxW, sum: wSum } = (cal && sums.get(cal)) || { max: 1, sum: 0 };
      r.v.style.width = `${Math.min(1, Math.max(0, val)) * 100}%`;
      // Geometry moves by a few hundredths, too little to see on the bar: show the number.
      const num = (GEOMETRY_FEATURE_NAMES as readonly string[]).includes(f) ? `${val.toFixed(3)} ` : "";
      if (cal) {
        r.n.style.left = `${Math.min(1, cal.neutral[f]) * 100}%`;
        r.s.style.left = `${Math.min(1, cal.strain[f]) * 100}%`;
        r.n.style.display = r.s.style.display = "";
        const w = cal.weights[f];
        r.w.textContent = `${num}${wSum > 0 ? Math.round((w / wSum) * 100) : 0}%`;
        r.row.classList.toggle("zero", w <= 0);
        r.v.style.opacity = String(0.4 + 0.6 * (w / maxW));
      } else {
        // No puff calibration yet: still mark the relaxed face from the main calibration.
        const neutral = usesPuff(f) ? d.calibration : null;
        r.n.style.display = neutral ? "" : "none";
        if (neutral) r.n.style.left = `${Math.min(1, neutral.neutral[f]) * 100}%`;
        r.s.style.display = "none";
        r.w.textContent = `${num}–`;
        r.row.classList.remove("zero");
        r.v.style.opacity = "1";
      }
    }
  }

  private drawPuffPlot(): void {
    const c = this.puffPlot;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const w = c.width;
    const h = c.height;
    ctx.clearRect(0, 0, w, h);
    const y = (v: number) => h - 6 - v * (h - 12);
    const dx = w / HISTORY;
    ctx.fillStyle = "rgba(239,71,111,0.15)";
    this.puffHistory.forEach((p, i) => {
      if (p.spiked) ctx.fillRect(i * dx, 0, dx + 1, h);
    });
    for (const [v, color] of [[config.oceanHoverPuff, "#3a86ff"], [config.oceanSpikeThreshold, "#ef476f"]] as const) {
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.setLineDash([8, 6]);
      ctx.beginPath();
      ctx.moveTo(0, y(v));
      ctx.lineTo(w, y(v));
      ctx.stroke();
      ctx.setLineDash([]);
    }
    const series = (get: (p: (typeof this.puffHistory)[number]) => number, color: string, width: number) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      this.puffHistory.forEach((p, i) => {
        if (i === 0) ctx.moveTo(i * dx, y(get(p)));
        else ctx.lineTo(i * dx, y(get(p)));
      });
      ctx.stroke();
    };
    series((p) => p.input, "#4cc9f0", 2);
    series((p) => p.raw, "#666", 2);
    series((p) => p.face, "#ffd166", 4);
  }

  private drawPlot(): void {
    const c = this.plot;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const w = c.width;
    const h = c.height;
    ctx.clearRect(0, 0, w, h);
    const y = (v: number) => h - 6 - v * (h - 12);
    const n = this.history.length;
    const dx = w / HISTORY;
    // Shade where "straining" is on
    ctx.fillStyle = "rgba(239,71,111,0.15)";
    this.history.forEach((p, i) => {
      if (p.active) ctx.fillRect(i * dx, 0, dx + 1, h);
    });
    // Threshold lines
    const line = (v: number, color: string) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.setLineDash([8, 6]);
      ctx.beginPath();
      ctx.moveTo(0, y(v));
      ctx.lineTo(w, y(v));
      ctx.stroke();
      ctx.setLineDash([]);
    };
    line(config.strainOn, "#ef476f");
    line(config.strainOff, "#3a86ff");
    const series = (get: (p: (typeof this.history)[number]) => number, color: string, width: number) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const py = y(get(this.history[i]));
        if (i === 0) ctx.moveTo(i * dx, py);
        else ctx.lineTo(i * dx, py);
      }
      ctx.stroke();
    };
    series((p) => p.charge, "#8ac926", 2);
    series((p) => p.raw, "#666", 2);
    series((p) => p.strain, "#ffd166", 4);
  }
}

function h3(text: string): HTMLElement {
  const e = document.createElement("h3");
  e.textContent = text;
  return e;
}

function div(cls: string): HTMLDivElement {
  const e = document.createElement("div");
  e.className = cls;
  return e;
}

function span(text: string): HTMLSpanElement {
  const e = document.createElement("span");
  e.textContent = text;
  return e;
}

function button(text: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.textContent = text;
  b.addEventListener("click", onClick);
  return b;
}
