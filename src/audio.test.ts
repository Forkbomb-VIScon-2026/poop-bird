import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Sound } from "./audio";
import { SOUND_NAMES } from "./audio-assets";

function buffer(channels = [[0, 0.5]], sampleRate = 1000): AudioBuffer {
  return {
    length: channels[0].length,
    numberOfChannels: channels.length,
    sampleRate,
    duration: channels[0].length / sampleRate,
    getChannelData: (channel: number) => new Float32Array(channels[channel]),
  } as AudioBuffer;
}

function gain() {
  return {
    gain: { value: 1, setTargetAtTime: vi.fn(), cancelScheduledValues: vi.fn() },
    connect: vi.fn().mockReturnThis(),
  };
}

function source() {
  return {
    buffer: null as AudioBuffer | null, loop: false, onended: null as (() => void) | null,
    playbackRate: { value: 1 }, start: vi.fn(), stop: vi.fn(), connect: vi.fn().mockReturnThis(),
  };
}

class Context {
  static latest: Context;
  state = "suspended";
  currentTime = 12;
  destination = {};
  sources: ReturnType<typeof source>[] = [];
  constructor(readonly options: AudioContextOptions) { Context.latest = this; }
  createGain = gain;
  decodeAudioData = vi.fn(async () => buffer());
  resume = vi.fn(async () => { this.state = "running"; });
  createBufferSource() {
    const node = source();
    this.sources.push(node);
    return node;
  }
}

beforeEach(() => {
  vi.stubGlobal("AudioContext", Context);
  vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array([1]))));
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("audio readiness and playback", () => {
  it("preloads once without resuming and waits for decoding before first playback", async () => {
    const sound = new Sound();
    const loading = sound.preload();
    const ctx = Context.latest;
    let finish!: (value: AudioBuffer) => void;
    expect(sound.preload()).toBe(loading);
    expect(ctx.resume).not.toHaveBeenCalled();
    expect(sound.ready).toBe(false);
    // All decodes deliberately share one gate.
    const decoded = new Promise<AudioBuffer>((resolve) => { finish = resolve; });
    ctx.decodeAudioData.mockImplementation(() => decoded);
    let unlocked = false;
    const ready = sound.unlock().then(() => { unlocked = true; });
    await vi.waitFor(() => expect(ctx.decodeAudioData).toHaveBeenCalledTimes(SOUND_NAMES.length));
    expect(unlocked).toBe(false);
    finish(buffer());
    await ready;
    expect(sound.ready).toBe(true);
    expect(ctx.options.latencyHint).toBe("interactive");
    const requests = vi.mocked(fetch).mock.calls.length;
    sound.hit(1);
    sound.hit(1);
    expect(ctx.sources).toHaveLength(2);
    for (const source of ctx.sources) expect(source.start).toHaveBeenCalledWith(12, 0);
    expect(vi.mocked(fetch).mock.calls).toHaveLength(requests);
    expect(ctx.decodeAudioData).toHaveBeenCalledTimes(SOUND_NAMES.length);
  });

  it("preserves Opus/MP3/WAV priority, decode fallback and placeholder fallback", async () => {
    const sound = new Sound();
    vi.mocked(fetch).mockImplementation(async (input) => {
      const path = String(input);
      const supported = path.endsWith("hit.mp3") || path.endsWith("splash.wav") || path.endsWith("tmp_spike.opus");
      return new Response(new Uint8Array([supported ? 1 : 0]), { status: path.endsWith(".opus") || supported ? 200 : 404 });
    });
    const loading = sound.preload();
    const ctx = Context.latest;
    ctx.decodeAudioData.mockImplementation(async (data?: ArrayBuffer) => {
      if (data && new Uint8Array(data)[0] === 0) throw new Error("unsupported encoding");
      return buffer();
    });
    await loading;
    await sound.unlock();
    sound.hit(1);
    sound.splash();
    sound.spike();
    expect(ctx.sources).toHaveLength(3);
    const paths = vi.mocked(fetch).mock.calls.map(([path]) => String(path));
    expect(paths.filter((path) => /\/(?:tmp_)?hit\./.test(path))).toEqual(["/assets/audio/hit.opus", "/assets/audio/hit.mp3"]);
    expect(paths.filter((path) => /\/(?:tmp_)?splash\./.test(path))).toEqual(["/assets/audio/splash.opus", "/assets/audio/splash.mp3", "/assets/audio/splash.wav"]);
    expect(paths).toContain("/assets/audio/tmp_spike.opus");
    expect(paths).not.toContain("/assets/audio/hit.wav");
  });

  it("skips quiet effect lead-ins while preserving explicit cue delays and the music timeline", async () => {
    const sound = new Sound();
    const loading = sound.preload();
    const samples = [...Array<number>(100).fill(0), 0.5];
    Context.latest.decodeAudioData.mockResolvedValue(buffer([samples]));
    await loading;
    await sound.unlock();
    sound.spike();
    sound.splash(0.6);
    sound.burner();
    sound.slingshotDraw(1);
    sound.reelClick();
    sound.setSharkTheme(0.05);
    sound.setPowerLineProximity(1);
    expect(Context.latest.sources.map((source) => source.start.mock.calls[0])).toEqual([
      [12, 0.095], [12.6, 0.095], [12.3, 0.095], [12.5, 0.095], [12.25, 0.095], [0, 0.05], [12, 0],
    ]);
    expect(Context.latest.sources.at(-1)?.loop).toBe(true);
  });

  it("keeps an onset in either stereo channel and leaves entirely quiet recordings alone", async () => {
    for (const channels of [[Array<number>(100).fill(0)], [Array<number>(100).fill(0), [0.5, ...Array<number>(99).fill(0)]]]) {
      const sound = new Sound();
      const loading = sound.preload();
      Context.latest.decodeAudioData.mockResolvedValue(buffer(channels));
      await loading;
      await sound.unlock();
      sound.hit(1);
      expect(Context.latest.sources[0].start).toHaveBeenCalledWith(12, 0);
    }
  });

  it("resumes an interrupted clock without queuing stale effects, and handles rejection", async () => {
    const sound = new Sound();
    await sound.unlock();
    const ctx = Context.latest;
    ctx.state = "interrupted";
    sound.hit(1);
    expect(ctx.sources).toHaveLength(0);
    await sound.unlock();
    sound.hit(1);
    expect(ctx.resume).toHaveBeenCalledTimes(2);
    expect(ctx.sources[0].start).toHaveBeenCalledWith(12, 0);
    ctx.state = "suspended";
    ctx.resume.mockRejectedValueOnce(new Error("blocked"));
    await expect(sound.unlock()).resolves.toBeUndefined();
    expect(console.warn).toHaveBeenCalledWith("[audio] could not resume", expect.any(Error));
  });

  it("missing recordings and an unavailable AudioContext do not block startup", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 404 }));
    const sound = new Sound();
    await sound.unlock();
    sound.hit(1);
    expect(sound.ready).toBe(true);
    expect(Context.latest.sources).toHaveLength(0);
    expect(console.warn).toHaveBeenCalledTimes(SOUND_NAMES.length);
    vi.stubGlobal("AudioContext", class { constructor() { throw new Error("unavailable"); } });
    const unavailable = new Sound();
    await expect(unavailable.unlock()).resolves.toBeUndefined();
    expect(unavailable.ready).toBe(true);
  });
});
