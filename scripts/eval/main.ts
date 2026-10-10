// Face detection scoreboard: replays every recording in data/ through each
// variant in variants.ts and prints per-recording numbers plus the mean over
// participants (each participant counts once, however many sessions they have).
//
//   npm run eval                   all participants except the held-out ones
//   npm run eval -- --holdout      only the held-out participants (before merging a change)
//   npm run eval -- --data <dir>   another data directory

import { defaultConfig } from "../../src/config";
import { loadRecordings, type Recording } from "./load";
import { scorePuff, type PuffGesture, type PuffScore } from "./puff";
import { scoreStrain, type StrainScore } from "./strain";
import { PUFF_VARIANTS, STRAIN_VARIANTS } from "./variants";

const args = process.argv.slice(3);
const holdout = args.includes("--holdout");
const dataDir = args.includes("--data") ? args[args.indexOf("--data") + 1] : "data";
const config = defaultConfig();

const all = loadRecordings(dataDir);
const recordings = all.filter((r) => r.holdout === holdout);
console.log(
  `${recordings.length} recordings from ${new Set(recordings.map((r) => r.participant)).size} participants` +
    ` (${holdout ? "held-out set" : `${all.length - recordings.length} held out`}), data from ${dataDir}/.\n`,
);
if (!recordings.length) {
  console.log("Nothing to score. Run `npm run data:pull`, or put recordings in data/local/.");
  process.exit(0);
}

// --- Formatting ------------------------------------------------------------------

const pct = (x: number) => (Number.isNaN(x) ? "–" : `${Math.round(x * 100)}%`);
const num = (x: number) => (Number.isNaN(x) ? "–" : x.toFixed(2));
function latency(v: number[]): string {
  const ok = v.filter(Number.isFinite).sort((a, b) => a - b);
  const missed = v.length - ok.length;
  const med = ok.length ? `${Math.round(ok[ok.length >> 1] * 1000)} ms` : "–";
  return missed ? `${med} (${missed}/${v.length} never)` : med;
}

function table(header: string[], rows: string[][]): void {
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const line = (cells: string[]) => cells.map((c, i) => (i === 0 ? c.padEnd(widths[i]) : c.padStart(widths[i]))).join("  ");
  console.log(line(header));
  console.log(widths.map((w) => "-".repeat(w)).join("  "));
  for (const r of rows) console.log(line(r));
  console.log("");
}

/** Mean of a per-recording number, first within each participant, then across participants. */
function participantMean<T>(scored: { rec: Recording; score: T }[], get: (s: T) => number): number {
  const byParticipant = new Map<string, number[]>();
  for (const { rec, score } of scored) {
    const v = get(score);
    if (Number.isNaN(v)) continue;
    byParticipant.set(rec.participant, [...(byParticipant.get(rec.participant) ?? []), v]);
  }
  const means = [...byParticipant.values()].map((v) => v.reduce((a, b) => a + b, 0) / v.length);
  return means.length ? means.reduce((a, b) => a + b, 0) / means.length : NaN;
}

// --- Strain ----------------------------------------------------------------------

console.log("STRAIN  hit = strain frames detected; false = relaxed / looking around / laughing frames detected;");
console.log("        early = releases in the middle of a strain; press/release = median time from the cue.\n");
for (const variant of STRAIN_VARIANTS) {
  const scored = recordings.flatMap((rec) => {
    const score = scoreStrain(rec, variant, config);
    return score ? [{ rec, score }] : [];
  });
  if (!scored.length) continue;
  console.log(`## ${variant.name}`);
  const row = (name: string, s: StrainScore) => [
    name, pct(s.hit), pct(s.falseRelaxed), pct(s.falseLook), pct(s.falseLaugh), pct(s.light), String(s.early),
    latency(s.press), latency(s.release),
  ];
  const mean = (get: (s: StrainScore) => number) => participantMean(scored, get);
  table(
    ["recording", "hit", "false", "look", "laugh", "light", "early", "press", "release"],
    [
      ...scored.map(({ rec, score }) => row(rec.id, score)),
      [
        "mean over participants", pct(mean((s) => s.hit)), pct(mean((s) => s.falseRelaxed)), pct(mean((s) => s.falseLook)),
        pct(mean((s) => s.falseLaugh)), pct(mean((s) => s.light)), num(mean((s) => s.early)), "", "",
      ],
    ],
  );
}

// --- Puff ------------------------------------------------------------------------

console.log("PUFF  median puff level while relaxed / at half puff / at full puff (ideal 0 / ~0.5 / 1);");
console.log("      sink / rise = relaxed frames below / puff frames above the hover point (ideal 100%);");
console.log("      spike = frames at or above the spike threshold (ideal 0); look = relaxed frames looking around (strain");
console.log("      script) above the hover point (ideal 0). Each gesture gets its own calibration,");
console.log("      from its first hold: plain puff, and the pufferfish face (puffing the cheeks while pursing the lips).\n");
const GESTURE_TITLES: Record<PuffGesture, string> = { plain: "plain puff", fish: "pufferfish face" };
for (const gesture of ["plain", "fish"] as const) {
  for (const variant of PUFF_VARIANTS) {
    const scored = recordings.flatMap((rec) => {
      const score = scorePuff(rec, variant, config, gesture);
      return score ? [{ rec, score }] : [];
    });
    if (!scored.length) {
      console.log(`## ${variant.name}, ${GESTURE_TITLES[gesture]}: no recordings with it yet\n`);
      continue;
    }
    console.log(`## ${variant.name}, ${GESTURE_TITLES[gesture]}`);
    const row = (name: string, s: PuffScore) => [
      name, num(s.relaxed), num(s.half), num(s.full), pct(s.sink), pct(s.rise), pct(s.spikeRelaxed), pct(s.spikeHalf),
      pct(s.look),
    ];
    const mean = (get: (s: PuffScore) => number) => participantMean(scored, get);
    table(
      ["recording", "relaxed", "half", "full", "sink", "rise", "spike relaxed", "spike half", "look"],
      [
        ...scored.map(({ rec, score }) => row(rec.id, score)),
        [
          "mean over participants", num(mean((s) => s.relaxed)), num(mean((s) => s.half)), num(mean((s) => s.full)),
          pct(mean((s) => s.sink)), pct(mean((s) => s.rise)), pct(mean((s) => s.spikeRelaxed)), pct(mean((s) => s.spikeHalf)),
          pct(mean((s) => s.look)),
        ],
      ],
    );
  }
}
