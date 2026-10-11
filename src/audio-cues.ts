/** Playback policy is data; simulation objects emit events, not Web Audio calls. */
import type { SoundName } from "./audio-assets";
import type { GameEvent } from "./game";

export type ResolvedCue = { sample: SoundName; volume?: number; delay?: number; channel?: string };
type Cue =
  | ResolvedCue
  | { random: readonly [SoundName, ...SoundName[]] }
  | { bag: readonly [SoundName, ...SoundName[]]; channel: string }
  | { strength: true }
  | { oceanEntry: true }
  | { sharkNote: true };

/** Exhaustive: every gameplay event explicitly has playback or is silent. */
const EVENT_CUES = {
  release: { strength: true }, accident: { sample: "accident" },
  splat: { sample: "splat" }, hit: { sample: "hit" }, crash: { sample: "splat" },
  chomp: { sample: "shark_bite" }, zap: { sample: "zap" },
  droneDown: { sample: "power_down" }, droneCrashed: { sample: "drone_crash" },
  gameover: [], gateEntered: { oceanEntry: true }, submerged: [],
  breached: { sample: "splash" }, transformed: { sample: "splash" }, surfaced: { sample: "splash" },
  spike: { sample: "spike" }, pop: { sample: "deflate" }, jellyPopped: { sample: "jelly_pop" },
  paparazzoBeep: { sample: "camera_beep" }, photo: { sample: "shutter" }, cameraSmashed: { sample: "smash" },
  slingshotDraw: { sample: "slingshot_draw", delay: 0.5 }, slingshotFire: { sample: "slingshot_fire" },
  bonk: { sample: "bonk" }, pebbleShot: { sample: "pebble_shot" }, ricochet: { sample: "ricochet" },
  kidCried: { sample: "kid_cry" },
  curse: { bag: ["curse_1", "curse_2", "curse_3", "curse_4"], channel: "curse" },
  weddingArrived: { sample: "wedding_arrived" }, weddingBeat: { sample: "wedding_beat" },
  weddingKiss: { sample: "wedding_kiss" }, weddingRuined: { sample: "wedding_ruined" },
  weddingMarried: { sample: "wedding_married" }, weddingPhoto: { sample: "shutter" },
  bouquetThrown: { sample: "bouquet_thrown" }, bouquetCaught: { sample: "bouquet_caught" },
  bouquetHit: { sample: "bouquet_hit" },
  balloonPop: [{ sample: "balloon_pop" }, { sample: "hit" }],
  chuteOpen: { random: ["chute_open_1", "chute_open_2"] },
  basketLanded: { sample: "basket_landed" }, burner: { sample: "burner", delay: 0.3 },
  threaded: { sample: "hit" }, anglerCast: { sample: "angler_cast" }, anglerHooked: { sample: "angler_hooked" },
  anglerReel: { sample: "reel_click", volume: 0.5, delay: 0.25 },
  anglerLanded: { sample: "splash" }, anglerPhoto: { sample: "shutter" }, lineSnapped: { sample: "line_snap" },
  sharkNote: { sharkNote: true }, sharkWindup: [], sharkLunge: { sample: "shark_lunge" },
  sharkSpiked: [{ sample: "shark_yelp" }, { sample: "hit" }],
  anchorWarn: [], anchorRattle: { sample: "reel_click", volume: 0.8, delay: 0.1 },
  anchorSnapped: { sample: "line_snap" }, anchorLanded: { sample: "bonk" },
} satisfies Record<GameEvent["type"], Cue | readonly Cue[]>;

export interface ReleaseThresholds { poopSoundMiddle: number; poopSoundLarge: number }
type BagState = { remaining: SoundName[]; last: SoundName | null };

export class CueResolver {
  private readonly bags = new Map<string, BagState>();
  private readonly random: () => number;
  constructor(random: () => number = () => Math.random()) { this.random = random; }

  resolve(event: GameEvent, params: ReleaseThresholds, hasSharkTheme: boolean): ResolvedCue[] {
    const definition: Cue | readonly Cue[] = EVENT_CUES[event.type];
    const cues: readonly Cue[] = Array.isArray(definition) ? definition : [definition as Cue];
    const output: ResolvedCue[] = [];
    for (const cue of cues) {
      if ("sample" in cue) output.push(cue);
      else if ("random" in cue) output.push({ sample: cue.random[Math.floor(this.random() * cue.random.length)] });
      else if ("bag" in cue) {
        let state = this.bags.get(cue.channel);
        if (!state) { state = { remaining: [], last: null }; this.bags.set(cue.channel, state); }
        if (state.remaining.length === 0) {
          state.remaining.push(...cue.bag);
          for (let i = state.remaining.length - 1; i > 0; i--) {
            const j = Math.floor(this.random() * (i + 1));
            [state.remaining[i], state.remaining[j]] = [state.remaining[j], state.remaining[i]];
          }
          if (state.remaining.length > 1 && state.remaining[0] === state.last) state.remaining.push(state.remaining.shift()!);
        }
        const sample = state.remaining.shift()!;
        state.last = sample;
        output.push({ sample, channel: cue.channel });
      } else if ("strength" in cue && event.type === "release") {
        const sample = event.charge >= params.poopSoundLarge ? "poop_large"
          : event.charge >= params.poopSoundMiddle ? "poop_middle" : "poop_weak";
        output.push({ sample });
      } else if ("oceanEntry" in cue && event.type === "gateEntered" && event.to === "ocean") {
        output.push({ sample: "splash" });
      } else if ("sharkNote" in cue && event.type === "sharkNote" && !hasSharkTheme) {
        output.push({ sample: event.high ? "shark_note_high" : "shark_note_low", volume: event.volume });
      }
    }
    return output;
  }
}
