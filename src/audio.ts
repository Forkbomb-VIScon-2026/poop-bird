
import { SOUND_NAMES, type SoundName } from "./audio-assets";

import { CueResolver, type ReleaseThresholds } from "./audio-cues";
import type { GameEvent } from "./game";

type ActiveSound = { source: AudioBufferSourceNode; gain: GainNode };

/** All game audio is sample-based; no synthesized sound effects. */
export class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  /** The shark's music, and the context time at which its position 0 would have played. */
  private theme: { sound: ActiveSound; zeroAt: number } | null = null;
  private readonly buffers = new Map<SoundName, AudioBuffer>();
  private readonly active = new Map<SoundName, ActiveSound>();
  private powerLine: ActiveSound | null = null;
  private readonly resolver = new CueResolver();
  private readonly channels = new Map<string, ActiveSound>();
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
    gain.gain.value = Math.max(0, volume);

    source.connect(gain).connect(this.master);
    source.start(ctx.currentTime + Math.max(0, delay));

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

  /** Resolve fixed, random, state-dependent and exclusive-channel event cues. */
  event(event: GameEvent, params: ReleaseThresholds): void {
    for (const cue of this.resolver.resolve(event, params, this.buffers.has("shark_theme"))) {
      const ctx = this.ctx;
      if (cue.channel && ctx) {
        const previous = this.channels.get(cue.channel);
        if (previous) {
          previous.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.03);
          previous.source.stop(ctx.currentTime + 0.15);
          this.channels.delete(cue.channel);
        }
      }
      const started = this.play(cue.sample, cue.volume ?? 1, cue.delay ?? 0);
      if (cue.channel && started) {
        const channel = cue.channel;
        this.channels.set(channel, started);
        started.source.onended = () => {
          if (this.channels.get(channel) === started) this.channels.delete(channel);
        };
      }
    }
  }

  sadTrombone(): void { this.play("sad_trombone"); }

  /**
   * Keeps the shark's music at `position` seconds into shark_theme (null =
   * stop it). Called every frame; it restarts at the right spot if it has
   * drifted, e.g. after a pause.
   */
  setSharkTheme(position: number | null): void {
    const ctx = this.ctx;
    if (!ctx) return;
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
