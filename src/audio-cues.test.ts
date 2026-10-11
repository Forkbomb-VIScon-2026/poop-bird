import { describe, expect, it } from "vitest";
import fixtureJson from "../tests/fixtures/audio-v1.json?raw";
import { CueResolver } from "./audio-cues";
import { SeededRng } from "./rng";
import type { GameEvent } from "./game";

const params = { poopSoundMiddle: 0.35, poopSoundLarge: 0.75 };
const fixture = JSON.parse(fixtureJson) as { cases: {
  event: GameEvent; theme: boolean; calls: { sample: string; volume: number; delay: number }[];
}[] };

describe("audio cue parity", () => {
  it("preserves original playback routing, variants, volume and delays", () => {
    for (const row of fixture.cases) {
      const resolver = new CueResolver(new SeededRng(1234).next);
      const actual = resolver.resolve(row.event, params, row.theme).map(cue => ({
        sample: cue.sample, volume: cue.volume ?? 1, delay: cue.delay ?? 0,
      }));
      expect(actual, row.event.type).toEqual(row.calls);
    }
  });
  it("plays every curse once per bag and never repeats at bag boundaries", () => {
    const resolver = new CueResolver(new SeededRng(1234).next);
    const names = Array.from({ length: 40 }, () => resolver.resolve({ type: "curse" }, params, false)[0]);
    for (let i = 0; i < names.length; i += 4) expect(new Set(names.slice(i, i + 4).map(n => n.sample)).size).toBe(4);
    for (let i = 1; i < names.length; i++) expect(names[i].sample).not.toBe(names[i - 1].sample);
    expect(names.every(n => n.channel === "curse")).toBe(true);
  });
  it("uses live release thresholds and keeps a city-bound gate silent", () => {
    const resolver = new CueResolver();
    expect(resolver.resolve({ type: "release", charge: 0.5, sweet: false }, params, false)[0].sample).toBe("poop_middle");
    expect(resolver.resolve({ type: "release", charge: 0.5, sweet: false }, { poopSoundMiddle: 0.6, poopSoundLarge: 0.9 }, false)[0].sample).toBe("poop_weak");
    expect(resolver.resolve({ type: "gateEntered", to: "city" }, params, false)).toEqual([]);
  });
});
