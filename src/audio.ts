import { SOUND_NAMES, type SoundName } from "./audio-assets";

export type PoopSize = "weak" | "middle" | "large";

type ActiveSound = { source: AudioBufferSourceNode; gain: GainNode };

/** All game audio is sample-based; no synthesized sound effects. */
export class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private readonly buffers = new Map<SoundName, AudioBuffer>();
  private readonly active = new Map<SoundName, ActiveSound>();
  private readonly lastPlayed = new Map<SoundName, number>();
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
        if (!response.ok || !response.headers.get("content-type")?.includes("audio")) return null;
        return await ctx.decodeAudioData(await response.arrayBuffer());
      } catch { return null; }
    };
    // Prefer MP3, but accept WAV assets too (including the poop recordings).
    const real = await fetchAudio(`${name}.mp3`) ?? await fetchAudio(`${name}.wav`);
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
      this.master.gain.setTargetAtTime(muted ? 0 : 0.6, this.ctx.currentTime, 0.02);
    }
  }

  toggleMute(): boolean {
    this.setMuted(!this.muted);
    return this.muted;
  }

  /** Playback of the cached, decoded buffer; concurrent one-shots are allowed. */
  private play(name: SoundName, volume = 1, cooldown = 0): ActiveSound | null {
    const ctx = this.ctx;
    const buffer = this.buffers.get(name);
    if (!ctx || !this.master || !buffer) return null;
    const now = ctx.currentTime;
    if (cooldown && now - (this.lastPlayed.get(name) ?? -Infinity) < cooldown) return null;
    this.lastPlayed.set(name, now);
    const source = ctx.createBufferSource();
    const gain = ctx.createGain();
    source.buffer = buffer;
    gain.gain.value = volume;
    source.connect(gain).connect(this.master);
    source.start();
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
      Math.min(1, Math.max(0.08, level)), ctx.currentTime, 0.04,
    );
  }

  setGroan(charge: number, _stressed: boolean): void { this.sustain("groan", charge); }
  setBurble(level: number): void { this.sustain("burble", level); }
  /** Continuous electrical hum; proximity is normalized to 0..1. */
  setPowerLineProximity(proximity: number): void {
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
      const started = this.play("power_line", 0);
      if (!started) return;
      started.source.loop = true;
      this.powerLine = started;
      started.source.onended = () => {
        if (this.powerLine === started) this.powerLine = null;
      };
    }
    // Quadratic falloff leaves the hum quiet until the bird is near a wire.
    this.powerLine.gain.gain.setTargetAtTime(level * level * 0.55, ctx.currentTime, 0.075);
  }
  splash(): void { this.play("splash"); }
  spike(): void { this.play("spike"); }
  jellyPop(_combo: number): void { this.play("jelly_pop"); }
  deflate(): void { this.play("deflate"); }
  /** Use the normalized charge (0..1) to choose the matching poop recording. */
  release(size: PoopSize, _charge: number, _sweet: boolean): void {
    this.play(`poop_${size}`);
  }
  accident(): void { this.play("accident"); }
  zap(): void { this.play("zap"); }
  balloonPop(): void { this.play("balloon_pop"); }
  chuteOpen(): void {
    this.play(`chute_open_${Math.floor(Math.random() * 2) + 1}`);
  }
  basketLanded(): void { this.play("basket_landed"); }
  burner(): void { this.play("burner", 1, 0.3); }
  splat(_big = false): void { this.play("splat"); }
  hit(_combo: number): void { this.play("hit"); }
  shutter(): void { this.play("shutter"); }
  cameraBeep(_timer: number): void { this.play("camera_beep"); }
  droneCrash(): void { this.play("drone_crash"); }
  slingshotDraw(_windup: number): void { this.play("slingshot_draw", 1, 0.5); }
  slingshotFire(): void { this.play("slingshot_fire"); }
  bonk(): void { this.play("bonk"); }
  pebbleShot(_combo: number): void { this.play("pebble_shot"); }
  ricochet(): void { this.play("ricochet"); }
  kidCry(): void { this.play("kid_cry"); }
  beep(_high = false): void { return; this.play("beep"); }
  sadTrombone(): void { this.play("sad_trombone"); }
  weddingKiss(): void { this.play("wedding_kiss"); }
  weddingRuined(): void { this.play("wedding_ruined"); }
  weddingMarried(): void { this.play("wedding_married"); }
  bouquetThrown(_angry: boolean): void { this.play("bouquet_thrown"); }
  bouquetCaught(): void { this.play("bouquet_caught"); }
  bouquetHit(): void { this.play("bouquet_hit"); }
  anglerCast(): void { this.play("angler_cast"); }
  anglerHooked(): void { this.play("angler_hooked"); }
  reelClick(): void { this.play("reel_click", 0.5, 0.25); }
  lineSnap(): void { this.play("line_snap"); }
}
