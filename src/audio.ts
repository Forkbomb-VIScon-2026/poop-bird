
import { SOUND_NAMES, type SoundName } from "./audio-assets";

export type PoopSize = "weak" | "middle" | "large";

type ActiveSound = { source: AudioBufferSourceNode; gain: GainNode };

/** All game audio is sample-based; no synthesized sound effects. */
export class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private readonly buffers = new Map<SoundName, AudioBuffer>();
  private readonly active = new Map<SoundName, ActiveSound>();
  private powerLine: ActiveSound | null = null;
  muted = false;

  /** A real asset takes priority; otherwise use its named bell placeholder. */
  private async load(name: SoundName): Promise<void> {
    const ctx = this.ctx;
    if (!ctx) return;

    const base = `${import.meta.env.BASE_URL}assets/audio/`;

    const fetchAudio = async (path: string): Promise<AudioBuffer | null> => {
      try {
        const response = await fetch(base + path);
        if (!response.ok || !response.headers.get("content-type")?.includes("audio")) {
          return null;
        }
        return await ctx.decodeAudioData(await response.arrayBuffer());
      } catch {
        return null;
      }
    };

    const real =
      await fetchAudio(`${name}.mp3`) ??
      await fetchAudio(`${name}.wav`);

    if (real) {
      this.buffers.set(name, real);
      return;
    }

    console.warn(`[audio] missing ${name}.mp3/.wav; using tmp_${name}.mp3`);

    const fallback = await fetchAudio(`tmp_${name}.mp3`);
    if (fallback) this.buffers.set(name, fallback);
    else console.warn(`[audio] missing placeholder tmp_${name}.mp3`);
  }

  /** Call after a user gesture to satisfy browser autoplay restrictions. */
  unlock(): void {
    try {
      if (!this.ctx) {
        this.ctx = new AudioContext();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : 0.6;
        this.master.connect(this.ctx.destination);

        for (const name of SOUND_NAMES) {
          void this.load(name);
        }
      }

      if (this.ctx.state === "suspended") void this.ctx.resume();
    } catch (error) {
      console.warn("[audio] unavailable", error);
    }
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.ctx && this.master) {
      this.master.gain.setTargetAtTime(
        muted ? 0 : 0.6,
        this.ctx.currentTime,
        0.02,
      );
    }
  }

  toggleMute(): boolean {
    this.setMuted(!this.muted);
    return this.muted;
  }

  /**
   * Play a cached sound.
   *
   * volume: multiplier (1 = normal, 0.5 = half)
   * delay:  seconds before playback (non-blocking)
   */
  private play(
    name: SoundName,
    volume = 1,
    delay = 0,
  ): ActiveSound | null {
    const ctx = this.ctx;
    const buffer = this.buffers.get(name);

    if (!ctx || !this.master || !buffer) return null;

    const source = ctx.createBufferSource();
    const gain = ctx.createGain();

    source.buffer = buffer;
    gain.gain.value = volume;

    source.connect(gain).connect(this.master);
    source.start(ctx.currentTime + Math.max(0, delay));

    return { source, gain };
  }

  private sustain(name: SoundName, level: number): void {
    const ctx = this.ctx;
    if (!ctx) return;

    const playing = this.active.get(name);

    if (level <= 0) {
      if (playing) {
        playing.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.025);
        playing.source.stop(ctx.currentTime + 0.15);
        this.active.delete(name);
      }
      return;
    }

    if (!playing) {
      const started = this.play(name, 0);
      if (!started) return;

      this.active.set(name, started);
      started.source.onended = () => {
        if (this.active.get(name) === started) this.active.delete(name);
      };
    }

    this.active.get(name)?.gain.gain.setTargetAtTime(
      Math.min(1, Math.max(0.08, level)),
      ctx.currentTime,
      0.04,
    );
  }

  setGroan(charge: number, _stressed: boolean): void {
    const volume = 1;
    const delay = 0;
    // Sustained sounds are controlled continuously; no startup delay.
    this.sustain("groan", charge * volume);
  }

  setBurble(level: number): void {
    const volume = 1;
    const delay = 0;
    this.sustain("burble", level * volume);
  }

  /** Continuous electrical hum; proximity is normalized to 0..1. */
  setPowerLineProximity(proximity: number): void {
    const volume = 0.55;
    const delay = 0;

    const ctx = this.ctx;
    if (!ctx) return;

    const level = Math.max(0, Math.min(1, proximity));

    if (level === 0) {
      if (this.powerLine) {
        const playing = this.powerLine;
        playing.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.035);
        playing.source.stop(ctx.currentTime + 0.25);
        this.powerLine = null;
      }
      return;
    }

    if (!this.powerLine) {
      const started = this.play("power_line", 0, delay);
      if (!started) return;

      started.source.loop = true;
      this.powerLine = started;
      started.source.onended = () => {
        if (this.powerLine === started) this.powerLine = null;
      };
    }

    this.powerLine.gain.gain.setTargetAtTime(
      level * level * volume,
      ctx.currentTime,
      0.075,
    );
  }

  splash(): void {
    const volume = 1;
    const delay = 0;
    this.play("splash", volume, delay);
  }

  spike(): void {
    const volume = 1;
    const delay = 0;
    this.play("spike", volume, delay);
  }

  jellyPop(_combo: number): void {
    const volume = 1;
    const delay = 0;
    this.play("jelly_pop", volume, delay);
  }

  deflate(): void {
    const volume = 1;
    const delay = 0;
    this.play("deflate", volume, delay);
  }

  /** Use the normalized charge (0..1) to choose the matching poop recording. */
  release(size: PoopSize, _charge: number, _sweet: boolean): void {
    const volume = 1;
    const delay = 0;
    this.play(`poop_${size}`, volume, delay);
  }

  accident(): void {
    const volume = 1;
    const delay = 0;
    this.play("accident", volume, delay);
  }

  zap(): void {
    const volume = 1;
    const delay = 0;
    this.play("zap", volume, delay);
  }

  balloonPop(): void {
    const volume = 1;
    const delay = 0;
    this.play("balloon_pop", volume, delay);
  }

  chuteOpen(): void {
    const volume = 1;
    const delay = 0;
    const variant = Math.floor(Math.random() * 2) + 1;
    this.play(`chute_open_${variant}` as SoundName, volume, delay);
  }

  basketLanded(): void {
    const volume = 1;
    const delay = 0;
    this.play("basket_landed", volume, delay);
  }

  burner(): void {
    const volume = 1;
    const delay = 0.3;
    this.play("burner", volume, delay);
  }

  splat(_big = false): void {
    const volume = 1;
    const delay = 0;
    this.play("splat", volume, delay);
  }

  hit(_combo: number): void {
    const volume = 1;
    const delay = 0;
    this.play("hit", volume, delay);
  }

  shutter(): void {
    const volume = 1;
    const delay = 0;
    this.play("shutter", volume, delay);
  }

  cameraBeep(_timer: number): void {
    const volume = 1;
    const delay = 0;
    this.play("camera_beep", volume, delay);
  }

  droneCrash(): void {
    const volume = 1;
    const delay = 0;
    this.play("drone_crash", volume, delay);
  }

  slingshotDraw(_windup: number): void {
    const volume = 1;
    const delay = 0.5;
    this.play("slingshot_draw", volume, delay);
  }

  slingshotFire(): void {
    const volume = 1;
    const delay = 0;
    this.play("slingshot_fire", volume, delay);
  }

  bonk(): void {
    const volume = 1;
    const delay = 0;
    this.play("bonk", volume, delay);
  }

  pebbleShot(_combo: number): void {
    const volume = 1;
    const delay = 0;
    this.play("pebble_shot", volume, delay);
  }

  ricochet(): void {
    const volume = 1;
    const delay = 0;
    this.play("ricochet", volume, delay);
  }

  kidCry(): void {
    const volume = 1;
    const delay = 0;
    this.play("kid_cry", volume, delay);
  }

  beep(_high = false): void {
    const volume = 1;
    const delay = 0;
    return; // Currently disabled
    this.play("beep", volume, delay);
  }

  sadTrombone(): void {
    const volume = 1;
    const delay = 0;
    this.play("sad_trombone", volume, delay);
  }

  weddingKiss(): void {
    const volume = 1;
    const delay = 0;
    this.play("wedding_kiss", volume, delay);
  }

  weddingRuined(): void {
    const volume = 1;
    const delay = 0;
    this.play("wedding_ruined", volume, delay);
  }

  weddingMarried(): void {
    const volume = 1;
    const delay = 0;
    this.play("wedding_married", volume, delay);
  }

  bouquetThrown(_angry: boolean): void {
    const volume = 1;
    const delay = 0;
    this.play("bouquet_thrown", volume, delay);
  }

  bouquetCaught(): void {
    const volume = 1;
    const delay = 0;
    this.play("bouquet_caught", volume, delay);
  }

  bouquetHit(): void {
    const volume = 1;
    const delay = 0;
    this.play("bouquet_hit", volume, delay);
  }

  anglerCast(): void {
    const volume = 1;
    const delay = 0;
    this.play("angler_cast", volume, delay);
  }

  anglerHooked(): void {
    const volume = 1;
    const delay = 0;
    this.play("angler_hooked", volume, delay);
  }

  reelClick(): void {
    const volume = 0.5;
    const delay = 0.25;
    this.play("reel_click", volume, delay);
  }

  lineSnap(): void {
    const volume = 1;
    const delay = 0;
    this.play("line_snap", volume, delay);
  }
}
