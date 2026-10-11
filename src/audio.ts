import { SOUND_NAMES, type SoundName } from "./audio-assets";

export type PoopSize = "weak" | "middle" | "large";

type ActiveSound = { source: AudioBufferSourceNode; gain: GainNode };

const CURSE_SOUNDS = SOUND_NAMES.filter((name) => name.startsWith("curse_"));

/** Keep a small pre-roll; only skip a measurable quiet lead-in, never music or a loop. */
function effectOffset(buffer: AudioBuffer): number {
  let first = buffer.length;
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const samples = buffer.getChannelData(channel);
    for (let i = 0; i < first; i++) {
      if (Math.abs(samples[i]) >= 0.001) { // -60 dBFS
        first = i;
        break;
      }
    }
  }
  const seconds = first / buffer.sampleRate;
  return first < buffer.length && seconds > 0.02 ? Math.max(0, seconds - 0.005) : 0;
}

function shuffle<T>(items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

/** All game audio is sample-based; no synthesized sound effects. */
export class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  /** The shark's music, and the context time at which its position 0 would have played. */
  private theme: { sound: ActiveSound; zeroAt: number } | null = null;
  private readonly buffers = new Map<SoundName, AudioBuffer>();
  private readonly offsets = new Map<SoundName, number>();
  private loading: Promise<void> | null = null;
  private loaded = false;
  private resuming: Promise<void> | null = null;
  private readonly active = new Map<SoundName, ActiveSound>();
  private powerLine: ActiveSound | null = null;
  private cursing: ActiveSound | null = null;
  private curseBag: SoundName[] = [];
  private lastCurse: SoundName | null = null;
  muted = false;

  /** Prefer Opus, then MP3/WAV, with placeholder fallback. */
  private async load(name: SoundName): Promise<void> {
    const ctx = this.ctx;
    if (!ctx) return;

    const base = `${import.meta.env.BASE_URL}assets/audio/`;
    const extensions = ["opus", "mp3", "wav"] as const;

    const fetchAudio = async (path: string): Promise<AudioBuffer | null> => {
      try {
        const response = await fetch(base + path);
        if (!response.ok) return null;
        return await ctx.decodeAudioData(await response.arrayBuffer());
      } catch {
        return null;
      }
    };

    for (const prefix of [name, `tmp_${name}`]) {
      for (const extension of extensions) {
        const buffer = await fetchAudio(`${prefix}.${extension}`);
        if (buffer) {
          this.buffers.set(name, buffer);
          if (name !== "shark_theme" && name !== "power_line") {
            this.offsets.set(name, effectOffset(buffer));
          }
          return;
        }
      }
    }

    console.warn(`[audio] missing or unsupported audio for ${name} (opus/mp3/wav)`);
  }

  /** Decode during the menu, even while autoplay keeps the context suspended. */
  preload(): Promise<void> {
    if (this.loading) return this.loading;
    try {
      if (!this.ctx) {
        this.ctx = new AudioContext({ latencyHint: "interactive" });
        this.master = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : 0.6;
        this.master.connect(this.ctx.destination);
      }
      this.loading = Promise.all(SOUND_NAMES.map((name) => this.load(name))).then(() => {
        this.loaded = true;
      });
    } catch (error) {
      console.warn("[audio] unavailable", error);
      // Audio is optional: an unsupported API must not block starting the game.
      this.loaded = true;
      this.loading = Promise.resolve();
    }
    return this.loading;
  }

  get ready(): boolean { return this.loaded; }

  /** Call synchronously from a user gesture, then await before starting gameplay. */
  unlock(): Promise<void> {
    const loading = this.preload();
    const ctx = this.ctx;
    if (ctx && ctx.state !== "running" && ctx.state !== "closed" && !this.resuming) {
      this.resuming = ctx.resume().catch((error: unknown) => {
        console.warn("[audio] could not resume", error);
      }).finally(() => { this.resuming = null; });
    }
    return Promise.all([loading, this.resuming]).then(() => {});
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

    // Don't queue stale effects on a stopped audio clock to burst out on resume.
    if (!ctx || ctx.state !== "running" || !this.master || !buffer) return null;

    const source = ctx.createBufferSource();
    const gain = ctx.createGain();

    source.buffer = buffer;
    gain.gain.value = Math.max(0, volume);

    source.connect(gain).connect(this.master);
    source.start(ctx.currentTime + Math.max(0, delay), this.offsets.get(name) ?? 0);

    return { source, gain };
  }


  private sustain(
    name: SoundName,
    level: number,
    volume = 1,
    delay = 0,
  ): void {
    const ctx = this.ctx;
    if (!ctx) return;

    const now = ctx.currentTime;
    const playing = this.active.get(name);

    if (level <= 0) {
      if (playing) {
        playing.gain.gain.cancelScheduledValues(now);
        playing.gain.gain.setTargetAtTime(0, now, 0.025);
        playing.source.stop(now + 0.15);
        this.active.delete(name);
      }
      return;
    }

    if (!playing) {
      const started = this.play(name, 0, delay);
      if (!started) return;

      this.active.set(name, started);

      started.source.onended = () => {
        if (this.active.get(name) === started) {
          this.active.delete(name);
        }
      };
    }

    const sound = this.active.get(name);
    if (!sound) return;

    const target = Math.min(1, Math.max(0.08, level)) * volume;

    sound.gain.gain.setTargetAtTime(
      target,
      now,
      0.04,
    );
  }


  setGroan(charge: number, _stressed: boolean): void {
    const volume = 1;
    const delay = 0;
    this.sustain("groan", charge, volume, delay);
  }

  setBurble(level: number): void {
    const volume = 1;
    const delay = 0;
    this.sustain("burble", level, volume, delay);
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

  splash(delay: number = 0): void {
    const volume = 1;
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

  /** A button press: the switch click, a touch higher or lower each time so repeats don't sound canned. */
  buttonClick(): void {
    const played = this.play("button_click", 0.85);
    if (played) played.source.playbackRate.value = 0.96 + Math.random() * 0.08;
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

  cameraBeep(_timer: number = 0): void {
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

  /** Cycles through the curse recordings in a shuffled order, never the same one twice in a row. */
  curse(): void {
    const volume = 1;
    const delay = 0;
    if (this.curseBag.length === 0) {
      this.curseBag = shuffle([...CURSE_SOUNDS]);
      if (this.curseBag[0] === this.lastCurse) this.curseBag.push(this.curseBag.shift()!);
    }
    const name = this.curseBag.shift()!;
    this.lastCurse = name;

    // A re-provoked pedestrian starts a new curse; cut the old one off rather than talk over it.
    const ctx = this.ctx;
    if (ctx && this.cursing) {
      this.cursing.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.03);
      this.cursing.source.stop(ctx.currentTime + 0.15);
    }
    const started = this.play(name, volume, delay);
    this.cursing = started;
    if (started) {
      started.source.onended = () => {
        if (this.cursing === started) this.cursing = null;
      };
    }
  }

  /** Additional event sounds used by the current gameplay code. */
  powerDown(): void { this.play("power_down"); }
  smash(): void { this.play("smash"); }
  weddingArrived(): void { this.play("wedding_arrived"); }
  weddingBeat(_count: number): void { this.play("wedding_beat"); }
  anchorRattle(): void { this.play("reel_click", 0.8, 0.1); }
  anchorLanded(): void { this.play("bonk"); }

  sharkBite(): void { this.play("shark_bite"); }
  sharkYelp(): void { this.play("shark_yelp"); }
  sharkLunge(): void { this.play("shark_lunge"); }

  /** One note of the synthesized two-note ostinato, louder as it closes in. Only without a shark_theme recording. */
  sharkNote(high: boolean, volume: number): void {
    if (this.buffers.has("shark_theme")) return;
    this.play(high ? "shark_note_high" : "shark_note_low", volume);
  }

  /**
   * Keeps the shark's music at `position` seconds into shark_theme (null =
   * stop it). Called every frame; it restarts at the right spot if it has
   * drifted, e.g. after a pause.
   */
  setSharkTheme(position: number | null): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== "running") return;
    const playing = this.theme;
    if (playing) {
      const drift = ctx.currentTime - playing.zeroAt - (position ?? Infinity);
      if (Math.abs(drift) < 0.3) return;
      // Stopping: a quick fade, so it's gone at once without a click.
      playing.sound.gain.gain.setTargetAtTime(0, ctx.currentTime, position === null ? 0.06 : 0.02);
      playing.sound.source.stop(ctx.currentTime + (position === null ? 0.4 : 0.1));
      this.theme = null;
    }
    const buffer = this.buffers.get("shark_theme");
    if (position === null || !buffer || !this.master || position >= buffer.duration) return;
    const source = ctx.createBufferSource();
    const gain = ctx.createGain();
    source.buffer = buffer;
    source.connect(gain).connect(this.master);
    source.start(0, Math.max(0, position));
    this.theme = { sound: { source, gain }, zeroAt: ctx.currentTime - position };
  }
}
