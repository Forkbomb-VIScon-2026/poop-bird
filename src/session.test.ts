import { describe, expect, it } from "vitest";
import {
  LANDMARK_COUNT,
  SESSION_SCHEMA,
  SegmentRecorder,
  calibrationScript,
  decodeFrames,
  decodeLandmarks,
  indexRow,
  newParticipantCode,
  newSessionId,
  FISH_PUFF_LABELS,
  PARTICIPANT_RE,
  PLAIN_PUFF_LABELS,
  PUFF_LABELS,
  puffScript,
  SESSION_RE,
  sessionQuality,
  strainScript,
  validateSession,
  type RecordedFrame,
  type SegmentData,
  type Session,
  type SessionStep,
} from "./session";

/** Deterministic random numbers in [0, 1). */
function seeded(seed = 1): () => number {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function landmarks(offset: number): RecordedFrame["landmarks"] {
  return Array.from({ length: LANDMARK_COUNT }, (_, i) => ({ x: 0.3 + i * 1e-3 + offset, y: 0.5 - offset, z: -0.02 }));
}

function frame(time: number, face: boolean, values: Record<string, number> = {}, offset = 0): RecordedFrame {
  return {
    time,
    features: face ? { browDown: 0.1, eyeSquint: 0.2, ...values } : null,
    blendshapes: face ? { browDownLeft: 0.1, browDownRight: 0.12 } : {},
    box: face ? { x: 0.3, y: 0.2, w: 0.4, h: 0.5 } : null,
    landmarks: face ? landmarks(offset) : null,
  };
}

/** Records `steps` at `fps`, with features from `values(label)` (null = no face). */
function record(
  name: SegmentData["name"],
  steps: SessionStep[],
  values: (label: string, i: number) => Record<string, number> | null,
  fps = 20,
): SegmentData {
  const rec = new SegmentRecorder(name, steps);
  rec.begin(1000);
  for (let i = 0; 1000 + (i * 1000) / fps < 1000 + rec.duration * 1000; i++) {
    const time = 1000 + (i * 1000) / fps;
    const step = rec.steps[rec.stepAt(time)];
    const v = values(step.label, i);
    rec.push(frame(time, v !== null, v ?? {}, i * 1e-4));
  }
  return rec.toJSON();
}

function session(segments: SegmentData[]): Session {
  return {
    schema: SESSION_SCHEMA,
    sessionId: "s-20261011-120000-abcdef",
    recordedAt: "2026-10-11T12:00:00.000Z",
    app: { commit: "test" },
    consent: { version: "test", text: "I agree.", agreedAt: "2026-10-11T11:59:00.000Z" },
    participant: { code: "pb-abc234", glasses: "none", facialHair: "none", lighting: "bright" },
    device: {
      userAgent: "test", platform: "Linux", mobile: false, camera: "Test cam", video: { width: 640, height: 480 }, delegate: "GPU",
    },
    check: { brightness: 120, faceSize: 0.4 },
    config: {},
    savedCalibrations: { strain: null, puff: null },
    segments,
  };
}

const STRAINED = ["strain", "pulseStrain", "longStrain", "lightStrain"];

describe("scripts", () => {
  it("mirror the game's calibration and add a relax-again phase", () => {
    const steps = calibrationScript(3);
    expect(steps.map((s) => s.label)).toEqual(["ready", "neutral", "ready", "strain", "relaxAgain"]);
    expect(steps.filter((s) => s.label !== "ready").every((s) => s.seconds === 3)).toBe(true);
  });

  it("randomize pulse lengths within bounds, reproducibly for a given random source", () => {
    const a = strainScript(seeded(7));
    const pulses = a.filter((s) => s.label.startsWith("pulse"));
    expect(pulses).toHaveLength(8);
    for (const p of pulses) {
      expect(p.seconds).toBeGreaterThanOrEqual(1);
      expect(p.seconds).toBeLessThanOrEqual(2.5);
    }
    expect(new Set(pulses.map((p) => p.seconds)).size).toBeGreaterThan(1);
    expect(strainScript(seeded(7))).toEqual(a);
  });

  it("record plain puffs and the pufferfish face, with pulses long enough to react to", () => {
    const steps = puffScript(seeded(3));
    const labels = new Set(steps.map((s) => s.label));
    for (const l of [...PLAIN_PUFF_LABELS, ...FISH_PUFF_LABELS]) expect(labels.has(l)).toBe(true);
    const pulses = steps.filter((s) => s.label === "puffPulse" || s.label === "fishPulse" || s.label === "puffRelax");
    expect(pulses).toHaveLength(16);
    for (const p of pulses) {
      expect(p.seconds).toBeGreaterThanOrEqual(2);
      expect(p.seconds).toBeLessThanOrEqual(3);
    }
    // Plain puffs first, so the start of the segment matches older sessions.
    expect(steps.findIndex((s) => s.label === "fullPuff")).toBeLessThan(steps.findIndex((s) => s.label === "fishPuff"));
  });

  it("beep high exactly on strain and puff steps", () => {
    for (const s of strainScript(seeded())) expect(s.beep === "high").toBe(STRAINED.includes(s.label));
    for (const s of puffScript(seeded())) expect(s.beep === "high").toBe(PUFF_LABELS.includes(s.label));
  });

  it("keep a full session under 3 minutes", () => {
    const total = [calibrationScript(3), strainScript(seeded()), puffScript(seeded())]
      .flat()
      .reduce((a, s) => a + s.seconds, 0);
    expect(total).toBeGreaterThan(90);
    expect(total).toBeLessThan(180);
  });
});

describe("SegmentRecorder", () => {
  const steps: SessionStep[] = [
    { seconds: 1, prompt: "a", label: "neutral" },
    { seconds: 0.5, prompt: "b", label: "strain" },
  ];

  it("plays the steps against the clock", () => {
    const rec = new SegmentRecorder("strain", steps);
    expect(rec.stepAt(0)).toBe(-1);
    rec.begin(1000);
    expect(rec.stepAt(999)).toBe(-1);
    expect(rec.stepAt(1000)).toBe(0);
    expect(rec.stepAt(1999)).toBe(0);
    expect(rec.stepAt(2000)).toBe(1);
    expect(rec.stepAt(2499)).toBe(1);
    expect(rec.stepAt(2500)).toBe(2);
    expect(rec.duration).toBe(1.5);
  });

  it("only records frames inside the script", () => {
    const rec = new SegmentRecorder("strain", steps);
    rec.push(frame(500, true));
    rec.begin(1000);
    rec.push(frame(900, true));
    rec.push(frame(1000, true));
    rec.push(frame(2600, true));
    expect(rec.frameCount).toBe(1);
  });

  it("round-trips features, labels and landmarks, including frames without a face", () => {
    const seg = record("strain", steps, (label, i) => (i % 7 === 3 ? null : { browDown: label === "strain" ? 0.8 : 0.1 }));
    const frames = decodeFrames(seg);
    expect(frames).toHaveLength(30);
    expect(frames[3].features).toBeNull();
    expect(frames[0]).toMatchObject({ label: "neutral", since: 0, features: { browDown: 0.1 } });
    expect(frames[25]).toMatchObject({ label: "strain", features: { browDown: 0.8 } });
    expect(frames[25].since).toBeCloseTo(0.25);

    const lm = decodeLandmarks(seg);
    const per = LANDMARK_COUNT * 3;
    expect(lm.length).toBe(30 * per);
    for (const i of [0, 4, 29]) {
      const expected = landmarks(i * 1e-4)!;
      expect(lm[i * per + 0]).toBeCloseTo(expected[0].x, 4);
      expect(lm[i * per + 3 * 100 + 1]).toBeCloseTo(expected[100].y, 4);
      expect(lm[i * per + 3 * 477 + 2]).toBeCloseTo(expected[477].z, 4);
    }
    expect(lm.subarray(3 * per, 4 * per).every((v) => v === 0)).toBe(true);
  });

  it("back-fills a feature that first appears mid-segment", () => {
    const seg = record("strain", steps, (_, i): Record<string, number> => (i < 5 ? {} : { mouthPress: 0.3 }));
    expect(seg.features.mouthPress).toHaveLength(seg.frames);
    expect(seg.features.mouthPress[0]).toBe(0);
    expect(seg.features.mouthPress[10]).toBe(0.3);
  });
});

describe("validateSession", () => {
  const good = () => JSON.parse(JSON.stringify(session([record("calibration", calibrationScript(3), () => ({}))])));

  it("accepts a recorded session after a JSON round trip", () => {
    expect(validateSession(good())).toBeNull();
  });

  it("rejects bad codes, missing consent and inconsistent columns", () => {
    expect(validateSession(null)).not.toBeNull();
    expect(validateSession({ ...good(), schema: 1 })).toMatch(/schema/);
    expect(validateSession({ ...good(), participant: { ...good().participant, code: "../etc" } })).toMatch(/participant/);
    expect(validateSession({ ...good(), sessionId: "s-../../x" })).toMatch(/sessionId/);
    expect(validateSession({ ...good(), consent: undefined })).toMatch(/consent/);
    const short = good();
    short.segments[0].t.pop();
    expect(validateSession(short)).toMatch(/segment/);
    const lm = good();
    lm.segments[0].landmarks = lm.segments[0].landmarks.slice(8);
    expect(validateSession(lm)).toMatch(/landmarks/);
  });

  it("generates ids and codes that pass validation", () => {
    expect(newParticipantCode(seeded())).toMatch(PARTICIPANT_RE);
    expect(newSessionId(new Date(Date.UTC(2026, 9, 11, 1, 2, 3)), seeded())).toMatch(SESSION_RE);
    expect(newSessionId(new Date(Date.UTC(2026, 9, 11, 1, 2, 3)), seeded())).toMatch(/^s-20261011-010203-/);
  });
});

describe("sessionQuality", () => {
  const strainValues = (label: string) =>
    STRAINED.includes(label) ? { browDown: 0.7, eyeSquint: 0.6 } : { browDown: 0.1, eyeSquint: 0.2 };

  it("passes a clean session and measures how much the strain moved the face", () => {
    const q = sessionQuality(session([record("strain", strainScript(seeded()), strainValues)]));
    expect(q.flags).toEqual([]);
    expect(q.faceCoverage).toBe(1);
    expect(q.detectionRate).toBeCloseTo(20, 0);
    expect(q.strainMoves).toBeCloseTo(0.5, 2);
  });

  it("flags lost faces, slow detection and a strain that didn't move the face", () => {
    const q = sessionQuality(
      session([record("strain", strainScript(seeded()), (_, i) => (i % 3 === 0 ? null : { browDown: 0.1 }), 8)]),
    );
    expect(q.flags).toHaveLength(3);
    expect(q.flags.join(" ")).toMatch(/face found in only 6\d%/);
    expect(q.flags.join(" ")).toMatch(/detections per second/);
    expect(q.flags.join(" ")).toMatch(/barely move/);
  });

  it("goes into the index row", () => {
    const row = indexRow(session([record("strain", strainScript(seeded()), strainValues)]), {
      uploadedAt: "2026-10-11T12:01:00.000Z", bytes: 1234,
    });
    expect(row).toMatchObject({
      participant: "pb-abc234", sessionId: "s-20261011-120000-abcdef", bytes: 1234,
      profile: { glasses: "none", facialHair: "none", lighting: "bright" },
      device: { platform: "Linux", camera: "Test cam", delegate: "GPU" },
      segments: [{ name: "strain" }],
      review: null,
    });
    expect(row.quality.flags).toEqual([]);
  });
});
