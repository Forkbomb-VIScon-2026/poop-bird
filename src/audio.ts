// All sound is synthesized with WebAudio. No audio files.

export class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private organWave: PeriodicWave | null = null;
  private groan: { osc: OscillatorNode; osc2: OscillatorNode; lfo: OscillatorNode; gain: GainNode; filter: BiquadFilterNode } | null = null;
  private burble: { src: AudioBufferSourceNode; blub: OscillatorNode; lfo: OscillatorNode; filter: BiquadFilterNode; gain: GainNode } | null = null;
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

  /**
   * Continuous underwater burble whose intensity follows the fish's puff
   * (like the groan for charge). level <= 0 stops it.
   */
  setBurble(level: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const t = ctx.currentTime;
    if (level <= 0) {
      if (this.burble) {
        const b = this.burble;
        b.gain.gain.setTargetAtTime(0, t, 0.04);
        const stopAt = t + 0.25;
        b.src.stop(stopAt);
        b.blub.stop(stopAt);
        b.lfo.stop(stopAt);
        this.burble = null;
      }
      return;
    }
    if (!this.burble) {
      const src = this.noise();
      if (!src) return;
      const blub = ctx.createOscillator();
      const blubGain = ctx.createGain();
      const lfo = ctx.createOscillator();
      const lfoDepth = ctx.createGain();
      const am = ctx.createGain();
      const filter = ctx.createBiquadFilter();
      const gain = ctx.createGain();
      // Noise through a resonant bandpass, chopped by a square LFO into bubbles,
      // plus a sine "blub" whose pitch wobbles with the same LFO.
      filter.type = "bandpass";
      filter.Q.value = 5;
      lfo.type = "square";
      lfoDepth.gain.value = 0.5;
      am.gain.value = 0.5;
      lfo.connect(lfoDepth).connect(am.gain);
      const pitchDepth = ctx.createGain();
      pitchDepth.gain.value = 60;
      lfo.connect(pitchDepth).connect(blub.frequency);
      blub.type = "sine";
      blub.frequency.value = 220;
      blubGain.gain.value = 0.5;
      src.connect(filter).connect(am);
      blub.connect(blubGain).connect(am);
      am.connect(gain).connect(this.master);
      gain.gain.value = 0;
      src.start(t, Math.random());
      blub.start(t);
      lfo.start(t);
      this.burble = { src, blub, lfo, filter, gain };
    }
    const b = this.burble;
    const x = Math.min(1, level);
    b.filter.frequency.setTargetAtTime(300 + x * 900, t, 0.05);
    b.blub.frequency.setTargetAtTime(170 + x * 160, t, 0.05);
    b.lfo.frequency.setTargetAtTime(4 + x * 11, t, 0.05);
    b.gain.gain.setTargetAtTime(0.03 + x * 0.09, t, 0.05);
  }

  /** Big splash into (or out of) the water. */
  splash(): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const t = ctx.currentTime;
    // Thump
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.25);
    g.gain.setValueAtTime(0.45, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.32);
    // Sploosh + spray
    this.noiseSweep(t, 0.6, 1400, 250, 0.4, "lowpass");
    this.noiseBurst(t + 0.02, 0.35, 2400, 0.22, "bandpass");
    // Trailing bubbles
    for (let i = 0; i < 6; i++) this.blip(t + 0.15 + i * 0.07 + Math.random() * 0.04, 350 + Math.random() * 500, 0.08);
  }

  /** Spikes out: a metallic "shing". */
  spike(): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const t = ctx.currentTime;
    [2093, 2637, 3322].forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "triangle";
      o.frequency.setValueAtTime(f * 0.85, t);
      o.frequency.exponentialRampToValueAtTime(f, t + 0.05);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.1 - i * 0.02, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
      o.connect(g).connect(this.master!);
      o.start(t);
      o.stop(t + 0.47);
    });
    this.noiseBurst(t, 0.12, 6000, 0.12, "highpass");
  }

  /** A jellyfish popped on the spines. */
  jellyPop(combo: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(950, t);
    o.frequency.exponentialRampToValueAtTime(160, t + 0.09);
    g.gain.setValueAtTime(0.4, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.13);
    this.noiseBurst(t, 0.05, 2200, 0.2, "bandpass");
    this.hit(combo);
  }

  /** Pop accident: the fish deflates with a long "pfffbbt". */
  deflate(): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const t = ctx.currentTime;
    // "pfff": hiss falling in pitch
    this.noiseSweep(t, 0.55, 3200, 700, 0.3, "bandpass");
    // "bbbt": flapping lips, a buzzy saw with a fast wobble, sinking
    const st = t + 0.35;
    const dur = 0.55;
    const osc = ctx.createOscillator();
    const wob = ctx.createOscillator();
    const wobGain = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    const g = ctx.createGain();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(150, st);
    osc.frequency.exponentialRampToValueAtTime(55, st + dur);
    wob.frequency.setValueAtTime(34, st);
    wob.frequency.linearRampToValueAtTime(14, st + dur);
    wobGain.gain.value = 45;
    wob.connect(wobGain).connect(osc.frequency);
    filter.type = "lowpass";
    filter.frequency.value = 1100;
    g.gain.setValueAtTime(0.0001, st);
    g.gain.exponentialRampToValueAtTime(0.3, st + 0.03);
    g.gain.exponentialRampToValueAtTime(0.001, st + dur);
    osc.connect(filter).connect(g).connect(this.master);
    osc.start(st);
    wob.start(st);
    osc.stop(st + dur + 0.02);
    wob.stop(st + dur + 0.02);
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

  /** Electric crackle and buzz for touching a power line. */
  zap(): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const t = ctx.currentTime;
    const dur = 0.6;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(110, t);
    osc.frequency.setValueAtTime(95, t + dur * 0.5);
    // Chopped on and off for the crackle.
    g.gain.setValueAtTime(0.0001, t);
    for (let i = 0; i < 14; i++) {
      const st = t + (i * dur) / 14;
      g.gain.setValueAtTime(i % 2 ? 0.05 : 0.3, st);
    }
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
    this.noiseBurst(t, 0.18, 5000, 0.35, "highpass");
    this.noiseBurst(t + 0.2, 0.15, 3500, 0.25, "highpass");
    this.noiseBurst(t + 0.38, 0.2, 2500, 0.2, "bandpass");
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

  /** Paparazzo shot: flash whine, then the mirror slap and shutter click-clack. */
  shutter(): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(2500, t);
    o.frequency.exponentialRampToValueAtTime(7000, t + 0.12);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.05, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.15);
    this.noiseBurst(t + 0.02, 0.035, 3500, 0.5, "highpass");
    this.noiseBurst(t + 0.09, 0.045, 2200, 0.4, "bandpass");
    this.noiseBurst(t + 0.02, 0.05, 400, 0.3, "lowpass");
  }

  /** The paparazzo's countdown tick; rises in pitch as his timer fills (0..1). */
  cameraBeep(timer: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "square";
    o.frequency.value = 1800 + timer * 1400;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.03 + timer * 0.03, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.06);
  }

  /** Camera smashed: glass crunch and tinkle. */
  smash(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    this.noiseBurst(t, 0.12, 4000, 0.35, "highpass");
    this.noiseBurst(t, 0.1, 900, 0.3, "bandpass");
    for (let i = 0; i < 5; i++) this.blip(t + 0.05 + i * 0.045 + Math.random() * 0.03, 2400 + Math.random() * 2400, 0.04);
  }

  /** Rubber band creaking tighter over the kid's wind-up. */
  slingshotDraw(windup: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    const g = ctx.createGain();
    o.type = "sawtooth";
    o.frequency.setValueAtTime(70, t);
    o.frequency.exponentialRampToValueAtTime(260, t + windup);
    // A fast wobble makes it creak instead of hum.
    lfo.frequency.setValueAtTime(18, t);
    lfo.frequency.linearRampToValueAtTime(45, t + windup);
    lfoGain.gain.value = 25;
    lfo.connect(lfoGain).connect(o.frequency);
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(600, t);
    filter.frequency.exponentialRampToValueAtTime(1800, t + windup);
    filter.Q.value = 3;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.05, t + windup * 0.8);
    g.gain.exponentialRampToValueAtTime(0.0001, t + windup);
    o.connect(filter).connect(g).connect(this.master);
    o.start(t);
    lfo.start(t);
    o.stop(t + windup + 0.02);
    lfo.stop(t + windup + 0.02);
  }

  /** The band snapping forward and the pebble whooshing off. */
  slingshotFire(): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "triangle";
    o.frequency.setValueAtTime(320, t);
    o.frequency.exponentialRampToValueAtTime(90, t + 0.18);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.25, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.22);
    this.noiseSweep(t + 0.02, 0.35, 900, 3500, 0.12, "bandpass");
  }

  /** Cartoon bonk on the head, then the kid's "nyah nyah". */
  bonk(): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(900, t);
    o.frequency.exponentialRampToValueAtTime(160, t + 0.22);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.4, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.3);
    this.noiseBurst(t, 0.05, 1800, 0.35, "bandpass");
    // Nyah nyah nyah-nyah nyah (G E A G E)
    const notes = [784, 659, 880, 784, 659];
    const lens = [0.14, 0.14, 0.1, 0.1, 0.22];
    let st = t + 0.35;
    notes.forEach((freq, i) => {
      const n = ctx.createOscillator();
      const ng = ctx.createGain();
      n.type = "square";
      n.frequency.value = freq;
      ng.gain.setValueAtTime(0.0001, st);
      ng.gain.exponentialRampToValueAtTime(0.045, st + 0.01);
      ng.gain.exponentialRampToValueAtTime(0.0001, st + lens[i] * 0.9);
      n.connect(ng).connect(this.master!);
      n.start(st);
      n.stop(st + lens[i]);
      st += lens[i];
    });
  }

  /** A poop shot a pebble down: crunchy splat and a bright ding. */
  pebbleShot(combo: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    this.noiseBurst(t, 0.2, 1100, 0.35, "bandpass");
    this.noiseBurst(t, 0.06, 4000, 0.25, "highpass");
    this.blip(t + 0.03, 1320, 0.12);
    this.blip(t + 0.1, 1760, 0.12);
    this.hit(combo);
  }

  /** A pebble pinging off a wall or pole. */
  ricochet(): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(2600, t);
    o.frequency.exponentialRampToValueAtTime(1500, t + 0.3);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.08, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.34);
    this.noiseBurst(t, 0.03, 5000, 0.2, "highpass");
  }

  /** The disarmed kid wailing: "waaah". */
  kidCry(): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const t = ctx.currentTime + 0.05;
    const dur = 0.9;
    const o = ctx.createOscillator();
    const vib = ctx.createOscillator();
    const vibGain = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    const g = ctx.createGain();
    o.type = "sawtooth";
    o.frequency.setValueAtTime(520, t);
    o.frequency.linearRampToValueAtTime(700, t + 0.15);
    o.frequency.exponentialRampToValueAtTime(380, t + dur);
    vib.frequency.value = 7;
    vibGain.gain.value = 30;
    vib.connect(vibGain).connect(o.frequency);
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(900, t);
    filter.frequency.linearRampToValueAtTime(2200, t + 0.15);
    filter.frequency.exponentialRampToValueAtTime(700, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.09, t + 0.06);
    g.gain.setValueAtTime(0.09, t + dur * 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(filter).connect(g).connect(this.master);
    o.start(t);
    vib.start(t);
    o.stop(t + dur + 0.02);
    vib.stop(t + dur + 0.02);
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

  // --- wedding ---------------------------------------------------------------

  /** One pipe-organ note: drawbar-style harmonics with a slow tremolo. */
  private organ(t: number, freq: number, dur: number, vol: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    if (!this.organWave) {
      const imag = new Float32Array([0, 1, 0.7, 0.4, 0.35, 0.12, 0.2, 0, 0.12]);
      this.organWave = ctx.createPeriodicWave(new Float32Array(imag.length), imag);
    }
    const o = ctx.createOscillator();
    const trem = ctx.createOscillator();
    const tremGain = ctx.createGain();
    const g = ctx.createGain();
    o.setPeriodicWave(this.organWave);
    o.frequency.value = freq;
    trem.frequency.value = 5.5;
    tremGain.gain.value = vol * 0.15;
    trem.connect(tremGain).connect(g.gain);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.03);
    g.gain.setValueAtTime(vol, t + Math.max(0.04, dur - 0.08));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    trem.start(t);
    o.stop(t + dur + 0.02);
    trem.stop(t + dur + 0.02);
  }

  /** A church bell: inharmonic partials with a long ring. */
  private bell(t: number, freq: number, vol: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    [[0.5, 0.5], [1, 1], [1.19, 0.5], [1.5, 0.35], [2, 0.3], [2.52, 0.2], [3.01, 0.12]].forEach(([ratio, amp]) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.frequency.value = freq * ratio;
      const dur = 2.2 / Math.sqrt(ratio);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol * amp, t + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(this.master!);
      o.start(t);
      o.stop(t + dur + 0.02);
    });
  }

  /** The wedding comes into view: church bells and "Here comes the bride" on the organ. */
  weddingArrived(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + 0.05;
    this.bell(t, 784, 0.07);
    this.bell(t + 0.5, 587, 0.07);
    // Wagner's Bridal Chorus: C F. F F—, over an F major chord.
    const beat = 0.27;
    const C4 = 261.63;
    const F4 = 349.23;
    const melody: [number, number, number][] = [[C4, 0, 1], [F4, 1, 0.75], [F4, 1.75, 0.25], [F4, 2, 2.4]];
    for (const [f, at, len] of melody) this.organ(t + at * beat, f, len * beat, 0.09);
    for (const f of [87.31, 174.61, 220, 261.63]) this.organ(t + 2 * beat, f, 2.4 * beat, 0.045);
  }

  /** A countdown beat (3, 2, 1): each tick a step higher. */
  weddingBeat(count: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const f = [987.77, 880, 783.99][Math.max(0, Math.min(2, count - 1))];
    this.organ(t, f, 0.16, 0.08);
    this.noiseBurst(t, 0.03, 3000, 0.12, "bandpass");
  }

  /** The kiss: a smooch and a sweet, held chord. */
  weddingKiss(): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const t = ctx.currentTime;
    this.noiseSweep(t, 0.12, 700, 2600, 0.25, "bandpass");
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(500, t + 0.08);
    o.frequency.exponentialRampToValueAtTime(1300, t + 0.14);
    g.gain.setValueAtTime(0.0001, t + 0.08);
    g.gain.exponentialRampToValueAtTime(0.2, t + 0.09);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    o.connect(g).connect(this.master);
    o.start(t + 0.08);
    o.stop(t + 0.17);
    for (const f of [523.25, 659.25, 783.99, 1046.5]) this.organ(t + 0.05, f, 0.9, 0.035);
  }

  /** Ruined: a record scratch, the bride's shriek and someone face-planting on the organ keys. */
  weddingRuined(): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const t = ctx.currentTime;
    this.noiseSweep(t, 0.14, 3200, 400, 0.45, "bandpass");
    this.noiseSweep(t + 0.13, 0.1, 500, 2600, 0.35, "bandpass");
    for (const f of [130.81, 138.59, 146.83, 185, 196, 277.18]) this.organ(t + 0.12, f, 1.1, 0.05);
    // Shriek
    const st = t + 0.18;
    const dur = 0.95;
    const o = ctx.createOscillator();
    const vib = ctx.createOscillator();
    const vibGain = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    const g = ctx.createGain();
    o.type = "sawtooth";
    o.frequency.setValueAtTime(900, st);
    o.frequency.linearRampToValueAtTime(1500, st + 0.12);
    o.frequency.exponentialRampToValueAtTime(1150, st + dur);
    vib.frequency.value = 11;
    vibGain.gain.value = 60;
    vib.connect(vibGain).connect(o.frequency);
    filter.type = "bandpass";
    filter.frequency.value = 1800;
    filter.Q.value = 1.4;
    g.gain.setValueAtTime(0.0001, st);
    g.gain.exponentialRampToValueAtTime(0.13, st + 0.05);
    g.gain.setValueAtTime(0.13, st + dur * 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, st + dur);
    o.connect(filter).connect(g).connect(this.master);
    o.start(st);
    vib.start(st);
    o.stop(st + dur + 0.02);
    vib.stop(st + dur + 0.02);
  }

  /** Married: a little organ fanfare and the guests cheering. */
  weddingMarried(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const G4 = 392;
    [0, 0.11, 0.22].forEach((at) => this.organ(t + at, G4, 0.1, 0.08));
    this.organ(t + 0.33, G4, 0.35, 0.08);
    for (const f of [261.63, 329.63, 392, 523.25]) this.organ(t + 0.7, f, 0.9, 0.05);
    this.organ(t + 0.7, 130.81, 0.9, 0.05);
    this.noiseSweep(t + 0.1, 1.3, 1800, 900, 0.12, "bandpass");
    this.bell(t + 0.7, 784, 0.05);
  }

  /** The bouquet leaves her hand: a whoosh (harder when it's thrown at you). */
  bouquetThrown(angry: boolean): void {
    const ctx = this.ctx;
    if (!ctx) return;
    this.noiseSweep(ctx.currentTime, angry ? 0.25 : 0.4, angry ? 500 : 900, angry ? 2400 : 3200, angry ? 0.35 : 0.2, "bandpass");
  }

  bouquetCaught(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    this.chime(t);
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => this.organ(t + i * 0.07, f, 0.3, 0.05));
  }

  /** Her bouquet hits the bird: a leafy thwap. */
  bouquetHit(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    this.noiseBurst(t, 0.12, 350, 0.45, "lowpass");
    this.noiseBurst(t, 0.25, 4000, 0.2, "highpass");
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

  /** One short bubble "blip": a sine that slides up. */
  private blip(t: number, freq: number, vol: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(freq * 1.8, t + 0.06);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.08);
  }

  /** Filtered noise whose filter frequency sweeps from `from` to `to`. */
  private noiseSweep(t: number, dur: number, from: number, to: number, vol: number, type: BiquadFilterType): void {
    const ctx = this.ctx;
    const src = this.noise();
    if (!ctx || !src || !this.master) return;
    const filter = ctx.createBiquadFilter();
    const g = ctx.createGain();
    filter.type = type;
    filter.Q.value = type === "bandpass" ? 1.5 : 0.7;
    filter.frequency.setValueAtTime(from, t);
    filter.frequency.exponentialRampToValueAtTime(to, t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filter).connect(g).connect(this.master);
    src.start(t, Math.random());
    src.stop(t + dur + 0.02);
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
