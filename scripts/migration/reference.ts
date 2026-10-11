/** Generate frozen numeric fixtures from the audited TypeScript kernels.
 * Run explicitly; tests never regenerate expected results automatically.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { stepCharge, initialChargeState, type ChargeParams } from "../../src/charge";
import { applyWaterDrag, guidePuff, initialSpikeState, popProgress, popWarning, puffForSwimVelocity, puffScale, stepSpike, targetSwimVelocity } from "../../src/swim";
import { circleRect } from "../../src/game";
import { config } from "../../src/config";

const rows: string[] = ["# protocol 1: 24 input numbers, 8 expected output numbers; baseline 4208bf7"];
function append(input: number[], output: number[]) {
  if (input.length > 24 || output.length > 8) throw new Error("fixture record overflow");
  rows.push([...input, ...Array<number>(24 - input.length).fill(0), ...output, ...Array<number>(8 - output.length).fill(0)].join(","));
}
let seed = 1234;
function random() {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 4294967296;
}
const params: ChargeParams = { ...config };
let charge = initialChargeState();
for (let i = 0; i < 960; i++) {
  const held = i < 280 || (i >= 350 && i < 610) || random() > 0.25;
  const dt = i % 11 === 0 ? 1 / 30 : 1 / 120;
  const result = stepCharge(charge, held, dt, params);
  const s = result.state;
  const e = result.event;
  append([0, charge.charge, charge.fullHold, charge.stun, +charge.needsRelease, +held, dt,
    params.chargeTime, params.overstrainTime, params.sweetSpotWindow, params.sweetSpotMultiplier,
    params.stunTime, params.pushMin, params.pushMax, params.pushCurve],
  [s.charge, s.fullHold, s.stun, +s.needsRelease, e?.type === "release" ? 1 : e ? 2 : 0,
    e?.charge ?? 0, e?.type === "release" ? e.push : 0, +(e?.type === "release" && e.sweetSpot)]);
  charge = s;
}
// Exact limit, disabled sweet window, overflow and forced-release cases.
for (const fullHold of [0.69, 0.7, 1, 1.0000000001]) {
  for (const held of [false, true]) {
    const state = { charge: 1, fullHold, stun: 0, needsRelease: false };
    const r = stepCharge(state, held, 0, params);
    const e = r.event;
    append([0, 1, fullHold, 0, 0, +held, 0, params.chargeTime, params.overstrainTime,
      params.sweetSpotWindow, params.sweetSpotMultiplier, params.stunTime, params.pushMin, params.pushMax, params.pushCurve],
    [r.state.charge, r.state.fullHold, r.state.stun, +r.state.needsRelease,
      e?.type === "release" ? 1 : e ? 2 : 0, e?.charge ?? 0,
      e?.type === "release" ? e.push : 0, +(e?.type === "release" && e.sweetSpot)]);
  }
}
let spike = initialSpikeState();
for (let i = 0; i < 960; i++) {
  const puff = i < 230 || (i >= 400 && i < 620) ? 1 : i < 370 ? 0 : random();
  const dt = 1 / 120;
  const r = stepSpike(spike, puff, dt, config);
  append([1, +spike.spiked, spike.hold, spike.stun, +spike.needsDeflate, puff, dt,
    config.oceanSpikeThreshold, config.oceanSpikeRelease, config.oceanSpikeMaxHold,
    config.oceanPopWarnTime, config.stunTime],
  [+r.state.spiked, r.state.hold, r.state.stun, +r.state.needsDeflate,
    r.event?.type === "spike" ? 1 : r.event?.type === "unspike" ? 2 : r.event ? 3 : 0,
    popProgress(r.state, config), +popWarning(r.state, config)]);
  spike = r.state;
}
for (const hover of [0, 0.01, 0.4, 0.99, 1]) {
  for (const puff of [-1, 0, 0.2, 0.4, 0.7, 1, 2]) {
    const p = { oceanMaxSink: 150, oceanMaxRise: 120, oceanHoverPuff: hover };
    append([2, puff, p.oceanMaxSink, p.oceanMaxRise, hover, 310, 300, 0.5, 0.75, 1.6],
      [targetSwimVelocity(puff, p), puffForSwimVelocity(targetSwimVelocity(puff, p), p),
        guidePuff(310, 300, 0.5, p), puffScale(puff, 0.75, 1.6)]);
  }
}
for (const dt of [-0.1, 0, 1 / 120, 0.35, 1]) {
  for (const drag of [-1, 0, 0.02, 0.35]) append([3, -200, 50, dt, drag], [applyWaterDrag(-200, 50, dt, drag)]);
}
for (const r of [0, 1, 5, 10]) {
  for (const x of [-5, -1, 0, 5, 10, 11, 15]) {
    for (const w of [-1, 0, 10]) append([4, x, 5, r, 0, 0, w, 10], [+circleRect(x, 5, r, { x: 0, y: 0, w, h: 10 })]);
  }
}
mkdirSync("tests/fixtures", { recursive: true });
writeFileSync("tests/fixtures/kernels-v1.csv", rows.join("\n") + "\n");
console.log(`Wrote ${rows.length - 1} reference cases`);
