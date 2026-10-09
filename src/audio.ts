// All sound is synthesized with WebAudio. No audio files.

export class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private groan: { osc: OscillatorNode; osc2: OscillatorNode; lfo: OscillatorNode; gain: GainNode; filter: BiquadFilterNode } | null = null;
  muted = false;

  /** Must be called from a user gesture (browsers block autoplay). */
  unlock(): void {
    try {
      if (!this.ctx) {
        const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        this.ctx = new Ctx();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : 0.6;
        this.master.connect(this.ctx.destination);
        this.noiseBuf = this.makeNoise(2);
      }
      if (this.ctx.state === "suspended") void this.ctx.resume();
    } catch (err) {
      console.warn("[audio] unavailable", err);
    }
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.6, this.ctx.currentTime, 0.02);
  }

  toggleMute(): boolean {
    this.setMuted(!this.muted);
    return this.muted;
  }

  private makeNoise(seconds: number): AudioBuffer | null {
    if (!this.ctx) return null;
    const buf = this.ctx.createBuffer(1, Math.floor(this.ctx.sampleRate * seconds), this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  private noise(): AudioBufferSourceNode | null {
    if (!this.ctx || !this.noiseBuf) return null;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    return src;
  }

  /** Continuous groan while charging; pitch rises with charge. charge < 0 stops it. */
  setGroan(charge: number, stressed: boolean): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const t = ctx.currentTime;
    if (charge <= 0) {
      if (this.groan) {
        const g = this.groan;
        g.gain.gain.setTargetAtTime(0, t, 0.03);
        const stopAt = t + 0.2;
        g.osc.stop(stopAt);
        g.osc2.stop(stopAt);
        g.lfo.stop(stopAt);
        this.groan = null;
      }
      return;
    }
    if (!this.groan) {
      const osc = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const lfo = ctx.createOscillator();
      const lfoGain = ctx.createGain();
      const filter = ctx.createBiquadFilter();
      const gain = ctx.createGain();
      osc.type = "sawtooth";
      osc2.type = "square";
      osc2.detune.value = 7;
      filter.type = "lowpass";
      filter.Q.value = 6;
      lfo.frequency.value = 6;
      lfoGain.gain.value = 6;
      lfo.connect(lfoGain);
      lfoGain.connect(osc.frequency);
      lfoGain.connect(osc2.frequency);
      osc.connect(filter);
      osc2.connect(filter);
      filter.connect(gain);
      gain.connect(this.master);
      gain.gain.value = 0;
      osc.start();
      osc2.start();
      lfo.start();
      this.groan = { osc, osc2, lfo, gain, filter };
    }
    const g = this.groan;
    const f = 85 + charge * 170;
    g.osc.frequency.setTargetAtTime(f, t, 0.05);
    g.osc2.frequency.setTargetAtTime(f * 0.5, t, 0.05);
    g.filter.frequency.setTargetAtTime(350 + charge * 1100, t, 0.05);
    g.lfo.frequency.setTargetAtTime(stressed ? 14 : 5 + charge * 4, t, 0.05);
    g.gain.gain.setTargetAtTime(0.06 + charge * 0.1, t, 0.04);
  }

  /** Release sound: a "plop" for tiny charges, a fart that grows with charge. */
  release(charge: number, sweet: boolean): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const t = ctx.currentTime;
    // Plop (always)
    const plop = ctx.createOscillator();
    const pg = ctx.createGain();
    plop.type = "sine";
    plop.frequency.setValueAtTime(500 + charge * 200, t);
    plop.frequency.exponentialRampToValueAtTime(90, t + 0.12);
    pg.gain.setValueAtTime(0.35, t);
    pg.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
    plop.connect(pg).connect(this.master);
    plop.start(t);
    plop.stop(t + 0.16);
    if (charge < 0.12) return;
    // Fart: buzzy low oscillator with wobbling pitch + noise.
    const dur = 0.15 + charge * 0.55;
    const osc = ctx.createOscillator();
    const wob = ctx.createOscillator();
    const wobGain = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    const g = ctx.createGain();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(110 + charge * 40 + (sweet ? 30 : 0), t);
    osc.frequency.exponentialRampToValueAtTime(45, t + dur);
    wob.frequency.value = 22 + Math.random() * 12;
    wobGain.gain.value = 25;
    wob.connect(wobGain).connect(osc.frequency);
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(900, t);
    filter.frequency.exponentialRampToValueAtTime(200, t + dur);
    g.gain.setValueAtTime(0.001, t);
    g.gain.exponentialRampToValueAtTime(0.25 + charge * 0.2, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(filter).connect(g).connect(this.master);
    osc.start(t);
    wob.start(t);
    osc.stop(t + dur + 0.02);
    wob.stop(t + dur + 0.02);
    this.noiseBurst(t, dur * 0.8, 400, 0.08 + charge * 0.08, "lowpass");
    if (sweet) this.chime(t + 0.05);
  }

  /** Long wet disaster sound for over-straining. */
  accident(): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const t = ctx.currentTime;
    const dur = 1.1;
    const osc = ctx.createOscillator();
    const wob = ctx.createOscillator();
    const wobGain = ctx.createGain();
    const g = ctx.createGain();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(160, t);
    osc.frequency.exponentialRampToValueAtTime(38, t + dur);
    wob.frequency.setValueAtTime(30, t);
    wob.frequency.linearRampToValueAtTime(9, t + dur);
    wobGain.gain.value = 40;
    wob.connect(wobGain).connect(osc.frequency);
    g.gain.setValueAtTime(0.4, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g).connect(this.master);
    osc.start(t);
    wob.start(t);
    osc.stop(t + dur);
    wob.stop(t + dur);
    this.noiseBurst(t, 0.5, 700, 0.35, "lowpass");
    this.noiseBurst(t + 0.25, 0.4, 1200, 0.2, "bandpass");
  }

  splat(big = false): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    this.noiseBurst(t, big ? 0.3 : 0.14, big ? 900 : 1500, big ? 0.35 : 0.22, "bandpass");
    this.noiseBurst(t, 0.08, 300, 0.25, "lowpass");
  }

  hit(combo: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const t = ctx.currentTime;
    const base = 520 * Math.pow(2, Math.min(combo - 1, 8) / 12);
    [0, 4, 7].forEach((semi, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "square";
      o.frequency.value = base * Math.pow(2, semi / 12);
      const st = t + 0.05 + i * 0.05;
      g.gain.setValueAtTime(0.0001, st);
      g.gain.exponentialRampToValueAtTime(0.08, st + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, st + 0.12);
      o.connect(g).connect(this.master!);
      o.start(st);
      o.stop(st + 0.13);
    });
  }

  beep(high = false): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "triangle";
    o.frequency.value = high ? 880 : 440;
    g.gain.setValueAtTime(0.2, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + (high ? 0.4 : 0.15));
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.4);
  }

  sadTrombone(): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const t0 = ctx.currentTime + 0.15;
    // Bb3 A3 Ab3 G3 (the classic "wah wah wah waaah")
    const notes = [233.08, 220.0, 207.65, 196.0];
    notes.forEach((f, i) => {
      const last = i === notes.length - 1;
      const st = t0 + i * 0.42;
      const dur = last ? 1.2 : 0.38;
      const o = ctx.createOscillator();
      const filter = ctx.createBiquadFilter();
      const g = ctx.createGain();
      o.type = "sawtooth";
      o.frequency.setValueAtTime(f * 1.02, st);
      o.frequency.linearRampToValueAtTime(f, st + 0.08);
      if (last) {
        const lfo = ctx.createOscillator();
        const lg = ctx.createGain();
        lfo.frequency.value = 5;
        lg.gain.value = 6;
        lfo.connect(lg).connect(o.frequency);
        lfo.start(st + 0.3);
        lfo.stop(st + dur);
        o.frequency.linearRampToValueAtTime(f * 0.94, st + dur);
      }
      filter.type = "lowpass";
      filter.frequency.setValueAtTime(600, st);
      filter.frequency.linearRampToValueAtTime(1400, st + 0.1);
      filter.frequency.linearRampToValueAtTime(700, st + dur);
      g.gain.setValueAtTime(0.0001, st);
      g.gain.exponentialRampToValueAtTime(0.2, st + 0.04);
      g.gain.setValueAtTime(0.2, st + dur - 0.1);
      g.gain.exponentialRampToValueAtTime(0.0001, st + dur);
      o.connect(filter).connect(g).connect(this.master!);
      o.start(st);
      o.stop(st + dur + 0.02);
    });
  }

  private chime(t: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    [1318.5, 1760].forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.frequency.value = f;
      const st = t + i * 0.07;
      g.gain.setValueAtTime(0.0001, st);
      g.gain.exponentialRampToValueAtTime(0.15, st + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, st + 0.3);
      o.connect(g).connect(this.master!);
      o.start(st);
      o.stop(st + 0.32);
    });
  }

  private noiseBurst(t: number, dur: number, freq: number, vol: number, type: BiquadFilterType): void {
    const ctx = this.ctx;
    const src = this.noise();
    if (!ctx || !src || !this.master) return;
    const filter = ctx.createBiquadFilter();
    const g = ctx.createGain();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = type === "bandpass" ? 1.2 : 0.7;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filter).connect(g).connect(this.master);
    src.start(t, Math.random());
    src.stop(t + dur + 0.02);
  }
}
