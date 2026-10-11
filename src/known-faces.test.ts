import { describe, expect, it } from "vitest";
import {
  ALIGNED_EYES,
  MAX_DESCRIPTORS,
  MAX_KNOWN_FACES,
  alignTransform,
  applyAffine,
  euclidean,
  faceDistance,
  goodView,
  nextFaceId,
  parseFaces,
  recognize,
  serializeFaces,
  upsertFace,
  withDescriptors,
  type Descriptor,
  type KnownFace,
} from "./known-faces";
import type { LandmarkPoint } from "./puff";
import { defaultCalibration, neutralFaceStats, zeroFeatures } from "./strain";

/** A 128-d descriptor: `base` everywhere, plus `bump` on dimension `i`. */
function desc(base: number, i = 0, bump = 0): number[] {
  const d = new Array<number>(128).fill(base);
  d[i] += bump;
  return d;
}

function face(id: number, descriptors: Descriptor[], lastSeen = id): KnownFace {
  return { id, descriptors, strain: null, strainIsDefault: false, puff: null, lastSeen };
}

describe("matching", () => {
  it("measures Euclidean distance", () => {
    expect(euclidean([0, 0], [3, 4])).toBe(5);
    expect(euclidean(desc(0), desc(0, 5, 0.5))).toBeCloseTo(0.5);
  });

  it("recognizes the nearest known face under the threshold", () => {
    const a = face(1, [desc(0)]);
    const b = face(2, [desc(0, 0, 0.4)]);
    const m = recognize([desc(0, 0, 0.3)], [a, b], 0.55);
    expect(m?.face.id).toBe(2);
    expect(m?.distance).toBeCloseTo(0.1);
  });

  it("calls a face new when every known face is too far", () => {
    expect(recognize([desc(0, 0, 0.7)], [face(1, [desc(0)])], 0.55)).toBeNull();
    expect(recognize([desc(0)], [], 0.55)).toBeNull();
  });

  it("takes the median over the samples, so one odd view doesn't decide", () => {
    const known = face(1, [desc(0)]);
    const samples = [desc(0, 1, 0.2), desc(0, 1, 0.3), desc(0, 1, 2)];
    expect(faceDistance(samples, known)).toBeCloseTo(0.3);
    expect(recognize(samples, [known], 0.55)?.face.id).toBe(1);
  });

  it("compares a sample with the nearest of a face's descriptors", () => {
    const known = face(1, [desc(0), desc(0, 3, 1)]);
    expect(faceDistance([desc(0, 3, 0.9)], known)).toBeCloseTo(0.1);
  });
});

describe("keeping faces", () => {
  it("adds only descriptors that add something, keeping the first one when full", () => {
    const f = face(1, [desc(0)]);
    expect(withDescriptors(f, [desc(0, 0, 0.05)]).descriptors).toHaveLength(1);
    const many = Array.from({ length: 10 }, (_, i) => desc(0, i + 1, 0.5));
    const full = withDescriptors(f, many);
    expect(full.descriptors).toHaveLength(MAX_DESCRIPTORS);
    expect(full.descriptors[0]).toEqual(desc(0));
    expect(full.descriptors.at(-1)).toEqual(many.at(-1));
    // The original isn't changed.
    expect(f.descriptors).toHaveLength(1);
  });

  it("enrolls a new face with its samples", () => {
    const enrolled = withDescriptors(face(1, []), [desc(0), desc(0, 0, 0.01), desc(0, 0, 0.5)]);
    expect(enrolled.descriptors).toEqual([desc(0), desc(0, 0, 0.5)]);
    expect(recognize([desc(0, 1, 0.1)], [enrolled], 0.45)?.face.id).toBe(1);
  });

  it("doesn't widen a face with a borderline sample", () => {
    const f = face(1, [desc(0)]);
    expect(withDescriptors(f, [desc(0, 0, 0.4)], 0.3).descriptors).toHaveLength(1);
    expect(withDescriptors(f, [desc(0, 0, 0.25)], 0.3).descriptors).toHaveLength(2);
  });

  it("replaces a face by id and drops the one seen longest ago when full", () => {
    let faces: KnownFace[] = [];
    for (let i = 1; i <= MAX_KNOWN_FACES; i++) faces = upsertFace(faces, face(i, [desc(i)], i));
    faces = upsertFace(faces, { ...face(1, [desc(1)]), lastSeen: 100 });
    expect(faces).toHaveLength(MAX_KNOWN_FACES);
    expect(faces.filter((f) => f.id === 1)).toHaveLength(1);
    faces = upsertFace(faces, face(nextFaceId(faces), [desc(9)], 200));
    expect(faces).toHaveLength(MAX_KNOWN_FACES);
    expect(faces.some((f) => f.id === 2)).toBe(false);
    expect(faces.some((f) => f.id === 1)).toBe(true);
    expect(nextFaceId(faces)).toBe(MAX_KNOWN_FACES + 2);
  });
});

describe("storage format", () => {
  const cal = defaultCalibration(neutralFaceStats([zeroFeatures(), zeroFeatures()]), 1);

  it("round-trips faces with their calibrations", () => {
    const f: KnownFace = { id: 3, descriptors: [desc(0.123456)], strain: cal, strainIsDefault: true, puff: null, lastSeen: 42 };
    const [back] = parseFaces(JSON.parse(serializeFaces([f])));
    expect(back.id).toBe(3);
    expect(back.descriptors[0][0]).toBeCloseTo(0.1235, 6);
    expect(back.strain?.weights).toEqual(cal.weights);
    expect(back.strainIsDefault).toBe(true);
    expect(back.puff).toBeNull();
    expect(back.lastSeen).toBe(42);
  });

  it("drops malformed entries and keeps the rest", () => {
    const good = { id: 1, descriptors: [desc(0)], strain: null, puff: null, lastSeen: 1 };
    const raw = [good, null, { id: "x", descriptors: [desc(0)] }, { id: 2, descriptors: [[NaN]] }, { id: 3, descriptors: "no" }];
    expect(parseFaces(raw).map((f) => f.id)).toEqual([1]);
    expect(parseFaces("nope")).toEqual([]);
    expect(parseFaces(null)).toEqual([]);
  });

  it("drops a calibration it can't restore, but keeps the face", () => {
    const [f] = parseFaces([{ id: 1, descriptors: [desc(0)], strain: { neutral: {} }, puff: 5 }]);
    expect(f.strain).toBeNull();
    expect(f.puff).toBeNull();
  });
});

describe("alignment", () => {
  it("puts the eyes at their canonical spots, level", () => {
    const left = { x: 300, y: 220 };
    const right = { x: 380, y: 250 };
    const m = alignTransform(left, right, 150)!;
    const l = applyAffine(m, left);
    const r = applyAffine(m, right);
    expect(l.x).toBeCloseTo(ALIGNED_EYES.left.x * 150);
    expect(l.y).toBeCloseTo(ALIGNED_EYES.left.y * 150);
    expect(r.x).toBeCloseTo(ALIGNED_EYES.right.x * 150);
    expect(r.y).toBeCloseTo(ALIGNED_EYES.right.y * 150);
  });

  it("has no transform for coinciding eyes", () => {
    expect(alignTransform({ x: 1, y: 1 }, { x: 1, y: 1 })).toBeNull();
  });

  /** Landmarks with just the eye corners and nose tip set (normalized), the nose shifted by `noseDx`. */
  function landmarks(noseDx: number): LandmarkPoint[] {
    const lm: LandmarkPoint[] = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
    lm[33] = { x: 0.4, y: 0.4, z: 0 };
    lm[133] = { x: 0.46, y: 0.4, z: 0 };
    lm[362] = { x: 0.54, y: 0.4, z: 0 };
    lm[263] = { x: 0.6, y: 0.4, z: 0 };
    lm[1] = { x: 0.5 + noseDx, y: 0.5, z: 0 };
    return lm;
  }

  it("takes a big frontal face, not a small or turned one", () => {
    const box = { x: 0.35, y: 0.3, w: 0.3, h: 0.4 };
    expect(goodView(landmarks(0), box, 640, 480, 80)).toBe(true);
    expect(goodView(landmarks(0), { ...box, w: 0.1 }, 640, 480, 80)).toBe(false);
    expect(goodView(landmarks(0.1), box, 640, 480, 80)).toBe(false);
  });
});
