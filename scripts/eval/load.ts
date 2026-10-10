// Loads face recordings for the eval scripts:
//   data/sessions/<participant>/<session>.json.gz   sessions from `npm run data:pull` (schema 2)
//   data/local/*.json(.gz)                          anything else: schema-2 files saved from the
//                                                   collect page, or old debug-recorder clips
// Every recording becomes segments of labelled frames.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { gunzipSync } from "node:zlib";
import { faceGeometry, type LandmarkPoint } from "../../src/puff";
import { LANDMARK_COUNT, decodeFrames, decodeLandmarks, type SegmentName, type Session } from "../../src/session";
import { extractFeatures, zeroFeatures, type FeatureVector } from "../../src/strain";

export interface Frame {
  /** Seconds since the segment start. */
  t: number;
  label: string;
  /** Seconds since the start of this frame's step. */
  since: number;
  /** null when no face was found. */
  f: FeatureVector | null;
}

export interface Recording {
  /** participant/session, or the file name for old clips. */
  id: string;
  participant: string;
  /** Held-out participants are only scored with --holdout. */
  holdout: boolean;
  segments: Partial<Record<SegmentName, Frame[]>>;
}

/**
 * About 1 in 5 participants form the test set, picked by a hash of the code
 * so it is fixed before anyone looks at their data.
 */
export function isHoldout(participant: string): boolean {
  let h = 2166136261;
  for (const c of participant) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return (h >>> 0) % 5 === 0;
}

function features(f: Record<string, number> | null): FeatureVector | null {
  return f ? { ...zeroFeatures(), ...f } : null;
}

/**
 * Sessions store the features as the recording build computed them, plus the
 * raw blendshapes and landmarks. The features are computed again here from
 * those with the current extractFeatures and faceGeometry, so features added
 * or changed since then score on every recording.
 */
function fromSession(s: Session, id: string): Recording {
  const segments: Recording["segments"] = {};
  const aspect = s.device.video.width / s.device.video.height;
  for (const seg of s.segments) {
    const landmarks = decodeLandmarks(seg);
    const per = LANDMARK_COUNT * 3;
    const shapes = Object.keys(seg.blendshapes);
    segments[seg.name] = decodeFrames(seg).map((fr, i) => {
      let f = features(fr.features);
      if (f) {
        const lm: LandmarkPoint[] = [];
        for (let j = 0; j < LANDMARK_COUNT; j++) {
          const k = i * per + j * 3;
          lm.push({ x: landmarks[k], y: landmarks[k + 1], z: landmarks[k + 2] });
        }
        const geometry = faceGeometry(lm, aspect);
        if (shapes.length) {
          const scores: Record<string, number> = {};
          for (const k of shapes) scores[k] = seg.blendshapes[k][i];
          f = extractFeatures(scores, geometry);
        } else {
          Object.assign(f, geometry);
        }
      }
      return { t: fr.t, label: fr.label, since: fr.since, f };
    });
  }
  return { id, participant: s.participant.code, holdout: isHoldout(s.participant.code), segments };
}

interface V1Clip {
  kind?: string;
  samples: { t: number; label: string; features: Record<string, number> | null }[];
}

/** Old debug-recorder clips: one script, so split it into the segments the eval expects. */
function fromV1(clip: V1Clip, id: string): Recording {
  let start = 0;
  const frames: Frame[] = clip.samples.map((x, i, all) => {
    if (i === 0 || all[i - 1].label !== x.label) start = x.t;
    return { t: x.t, label: x.label, since: x.t - start, f: features(x.features) };
  });
  const segments: Recording["segments"] = {};
  if (clip.kind === "strain") {
    // neutral → strain → relax mirrors the calibration (relax = relaxAgain); the rest is the test.
    segments.calibration = frames
      .filter((f) => ["neutral", "strain", "relax"].includes(f.label))
      .map((f) => (f.label === "relax" ? { ...f, label: "relaxAgain" } : f));
    segments.strain = frames.slice(frames.findIndex((f) => f.label === "pulseStrain"));
  } else {
    // Puff clips: neutral → hold → neutral2 → pulses.
    const rename: Record<string, string> = { hold: "fullPuff", neutral2: "relax", pulses: "puffPulses" };
    segments.calibration = frames.filter((f) => f.label === "neutral");
    segments.puff = frames.map((f) => ({ ...f, label: rename[f.label] ?? f.label }));
  }
  return { id, participant: `v1:${id}`, holdout: false, segments };
}

function parse(file: string): unknown {
  const raw = readFileSync(file);
  return JSON.parse((file.endsWith(".gz") ? gunzipSync(raw) : raw).toString("utf8"));
}

function load(file: string, id: string): Recording {
  const data = parse(file) as { schema?: number };
  return data.schema === 2 ? fromSession(data as Session, id) : fromV1(data as V1Clip, id);
}

export function loadRecordings(dir = "data"): Recording[] {
  const out: Recording[] = [];
  const sessions = join(dir, "sessions");
  if (existsSync(sessions)) {
    for (const p of readdirSync(sessions).sort()) {
      for (const f of readdirSync(join(sessions, p)).sort()) {
        if (f.endsWith(".json.gz")) out.push(load(join(sessions, p, f), `${p}/${f.replace(".json.gz", "")}`));
      }
    }
  }
  const local = join(dir, "local");
  if (existsSync(local)) {
    for (const f of readdirSync(local).sort()) {
      if (/\.json(\.gz)?$/.test(f)) out.push(load(join(local, f), basename(f).replace(/\.json(\.gz)?$/, "")));
    }
  }
  return out;
}
