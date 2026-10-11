// Exercise the actual browser-target WASM binary and generated JS in Node.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import init, { evaluate_batch, protocol_version } from "../../public/game-wasm/poop_bird_wasm.js";

await init({ module_or_path: await readFile(new URL("../../public/game-wasm/poop_bird_wasm_bg.wasm", import.meta.url)) });
assert.equal(protocol_version(), 1);
const input = [];
const expected = [];
const csv = await readFile(new URL("../../tests/fixtures/kernels-v1.csv", import.meta.url), "utf8");
for (const line of csv.trim().split("\n").filter(l => !l.startsWith("#"))) {
  const row = line.split(",").map(Number);
  assert.equal(row.length, 32);
  input.push(...row.slice(0, 24));
  expected.push(...row.slice(24));
}
const output = evaluate_batch(new Float64Array(input));
assert.ok(output instanceof Float64Array);
assert.equal(output.length, expected.length);
for (let i = 0; i < output.length; i++) {
  const tolerance = 1e-12 * Math.max(1, Math.abs(expected[i]));
  assert.ok(Math.abs(output[i] - expected[i]) <= tolerance,
    `case ${Math.floor(i / 8)}, field ${i % 8}: ${output[i]} != ${expected[i]}`);
}
assert.equal(evaluate_batch(new Float64Array()).length, 0);
assert.throws(() => evaluate_batch(new Float64Array([0])), /IncompleteRecord/);
const bad = new Float64Array(24);
bad[0] = 99;
assert.throws(() => evaluate_batch(bad), /UnknownOperation/);
bad[0] = 0;
bad[5] = 0.5;
assert.throws(() => evaluate_batch(bad), /InvalidBoolean/);
bad[5] = 0;
bad[7] = NaN;
assert.throws(() => evaluate_batch(bad), /NonFinite/);
// Trigger a larger allocation, then ensure earlier returned copies remain valid.
const saved = output.slice();
const large = new Float64Array(input.length * 4);
for (let i = 0; i < 4; i++) large.set(input, i * input.length);
assert.equal(evaluate_batch(large).length, expected.length * 4);
assert.deepEqual(output, saved);
console.log(`WASM: ${expected.length / 8} frozen cases passed, malformed batches rejected, returned copies survive memory growth`);
