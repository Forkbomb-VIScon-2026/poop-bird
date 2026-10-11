import { describe, expect, it } from "vitest";
import type { FaceBox } from "./face";
import { mulberry32 } from "./duel";
import {
  ALIGNED_EYES,
  ALIGNED_SIZE,
  BankSteer,
  KeySteer,
  acquireFace,
  alignTransform,
  appearanceCheck,
  appearanceVerdict,
  applyAffine,
  bankCommand,
  bhattacharyya,
  boxIoU,
  continuesTrack,
  distanceVerdict,
  eyeCentres,
  faceQuality,
  galleryDistance,
  guardConvergence,
  headRoll,
  hsvHistogram,
  identitySettled,
  initialIdentity,
  missingFor,
  pairDecision,
  recognitionCheck,
  recognize,
  trackFace,
  type Descriptor,
  type IdentityParams,
  type IdentityState,
  type PlayerId,
  type Signature,
} from "./duo";
import type { LandmarkPoint } from "./puff";

const P: IdentityParams = {
  maxJump: 1,
  maxScale: 1.5,
  convergeIoU: 0.3,
  lostTime: 2,
  midlineMargin: 0.04,
  strikes: 3,
  confirmChecks: 2,
  sides: false,
  unknown: 0.6,
  margin: 0.1,
};
const FALLBACK: IdentityParams = { ...P, sides: true };

/** A face box at mirrored centre x (what the players see), normalized size w. */
function faceAt(mirrored: number, y = 0.4, w = 0.18): FaceBox {
  const cx = 1 - mirrored;
  return { x: cx - w / 2, y: y - w / 2, w, h: w * 1.15 };
}

/** Both players seated and locked: P1 on the left, P2 on the right. */
function seated(params = P, now = 0): IdentityState {
  let s = initialIdentity();
  s = acquireFace(s, 0, faceAt(0.3), null, now, params).state;
  s = acquireFace(s, 1, faceAt(0.7), null, now, params).state;
  expect(s.players.map((t) => t.status)).toEqual(["locked", "locked"]);
  return s;
}

// --- Synthetic people for recognition -------------------------------------------

function person(seed: number): number[] {
  const r = mulberry32(seed);
  const v = Array.from({ length: 128 }, () => r() * 2 - 1);
  const n = Math.hypot(...v);
  return v.map((x) => x / n);
}

/** A descriptor of `base` with noise: typical same-person distance ≈ sigma·√128. */
function sample(base: number[], rng: () => number, sigma = 0.025): number[] {
  return base.map((x) => x + (rng() * 2 - 1) * sigma * Math.sqrt(3));
}

describe("box geometry", () => {
  it("IoU and continuity", () => {
    const a = faceAt(0.3);
    expect(boxIoU(a, a)).toBeCloseTo(1);
    expect(boxIoU(a, faceAt(0.7))).toBe(0);
    expect(continuesTrack(a, faceAt(0.32), 1)).toBe(true);
    // More than a face width in one frame: not the same track.
    expect(continuesTrack(a, faceAt(0.55), 1)).toBe(false);
    // Abrupt size change: not the same track.
    expect(continuesTrack(a, faceAt(0.3, 0.4, 0.3), 1)).toBe(false);
  });
});

describe("steering: head bank", () => {
  /** Landmarks with the outer/inner eye corners and nose for a head tilted by `deg` toward the player's right. */
  function tiltedFace(deg: number, cx = 0.5, cy = 0.4, aspect = 4 / 3): LandmarkPoint[] {
    const lm: LandmarkPoint[] = Array.from({ length: 478 }, () => ({ x: cx, y: cy, z: 0 }));
    const rad = (deg * Math.PI) / 180;
    // Tilting toward the player's right lowers their right eye (image left).
    const put = (i: number, dx: number, dy: number) => {
      const x = dx * Math.cos(rad) + dy * Math.sin(rad);
      const y = -dx * Math.sin(rad) + dy * Math.cos(rad);
      lm[i] = { x: cx + x / aspect, y: cy + y, z: 0 };
    };
    put(33, -0.08, 0);
    put(133, -0.03, 0);
    put(362, 0.03, 0);
    put(263, 0.08, 0);
    put(1, 0, 0.05);
    return lm;
  }

  it("measures the roll from the eye corners, positive toward the player's right", () => {
    expect(headRoll(tiltedFace(0), 4 / 3)).toBeCloseTo(0, 5);
    expect(headRoll(tiltedFace(15), 4 / 3)).toBeCloseTo(15, 5);
    expect(headRoll(tiltedFace(-20), 4 / 3)).toBeCloseTo(-20, 5);
  });

  it("dead zone, full turn and sign, relative to the home roll", () => {
    const p = { deadZone: 5, full: 25 };
    expect(bankCommand(4, 0, p)).toBe(0);
    expect(bankCommand(-4.9, 0, p)).toBe(0);
    expect(bankCommand(15, 0, p)).toBeCloseTo(0.5);
    expect(bankCommand(-40, 0, p)).toBe(-1);
    // A player who sits tilted: their natural tilt is level.
    expect(bankCommand(8, 8, p)).toBe(0);
    expect(bankCommand(23, 8, p)).toBeCloseTo(0.5);
    expect(bankCommand(NaN, 0, p)).toBe(0);
  });

  it("straining jitter (a few degrees of roll noise) doesn't steer", () => {
    const steer = new BankSteer(() => ({ deadZone: 5, full: 25, smoothing: 0.12 }));
    const rng = mulberry32(3);
    let maxAbs = 0;
    for (let i = 0; i < 300; i++) {
      steer.update((rng() * 2 - 1) * 4, 1 / 30);
      maxAbs = Math.max(maxAbs, Math.abs(steer.command()));
    }
    expect(maxAbs).toBe(0);
    // A real bank does, and a level head (or a lost face) eases back to straight.
    for (let i = 0; i < 30; i++) steer.update(20, 1 / 30);
    expect(steer.command()).toBeGreaterThan(0.6);
    for (let i = 0; i < 30; i++) steer.update(null, 1 / 30);
    expect(Math.abs(steer.command())).toBeLessThan(0.01);
  });

  it("keys: left, right, both", () => {
    const k = new KeySteer();
    expect(k.command()).toBe(0);
    k.left = true;
    expect(k.command()).toBe(-1);
    k.right = true;
    expect(k.command()).toBe(0);
    k.left = false;
    expect(k.command()).toBe(1);
  });

  it("face quality: rejects small and turned faces, not tilted ones", () => {
    const box = { x: 0.4, y: 0.3, w: 0.2, h: 0.25 };
    expect(faceQuality(tiltedFace(0), box, 640, 480).ok).toBe(true);
    expect(faceQuality(tiltedFace(25), box, 640, 480).ok).toBe(true);
    expect(faceQuality(tiltedFace(0), { ...box, w: 0.1 }, 640, 480).ok).toBe(false);
    const turned = tiltedFace(0);
    turned[1] = { ...turned[1], x: turned[1].x + 0.05 };
    expect(faceQuality(turned, box, 640, 480).ok).toBe(false);
  });

  it("alignment puts the eye centres at their canonical spots, level", () => {
    for (const deg of [0, 17, -30]) {
      const lm = tiltedFace(deg, 0.45, 0.42);
      const eyes = eyeCentres(lm, 640, 480)!;
      const m = alignTransform(eyes.left, eyes.right)!;
      const l = applyAffine(m, eyes.left);
      const r = applyAffine(m, eyes.right);
      expect(l.x).toBeCloseTo(ALIGNED_EYES.left.x * ALIGNED_SIZE, 6);
      expect(l.y).toBeCloseTo(ALIGNED_EYES.left.y * ALIGNED_SIZE, 6);
      expect(r.x).toBeCloseTo(ALIGNED_EYES.right.x * ALIGNED_SIZE, 6);
      expect(r.y).toBeCloseTo(ALIGNED_EYES.right.y * ALIGNED_SIZE, 6);
      // A similarity transform: the nose lands below the eye midpoint, centred.
      const nose = applyAffine(m, { x: lm[1].x * 640, y: lm[1].y * 480 });
      expect(nose.x).toBeCloseTo(ALIGNED_SIZE / 2, 6);
      expect(nose.y).toBeGreaterThan(l.y);
    }
    expect(alignTransform({ x: 1, y: 1 }, { x: 1, y: 1 })).toBeNull();
  });
});

describe("recognition decisions", () => {
  const alice = person(1);
  const bob = person(2);
  const carol = person(3);
  const rng = mulberry32(9);
  const gallery = (base: number[]) => Array.from({ length: 7 }, () => sample(base, rng));
  const G: [Descriptor[], Descriptor[]] = [gallery(alice), gallery(bob)];
  const dists = (d: number[]): [number, number] => [galleryDistance(d, G[0]), galleryDistance(d, G[1])];

  it("synthetic people: same person near, different people far", () => {
    expect(galleryDistance(sample(alice, rng), G[0])).toBeLessThan(0.45);
    expect(galleryDistance(sample(alice, rng), G[1])).toBeGreaterThan(0.9);
    expect(galleryDistance(alice, [])).toBe(Infinity);
  });

  it("verdicts: match, other, stranger, ambiguous", () => {
    expect(distanceVerdict(0.3, 0.9, P)).toBe("match");
    expect(distanceVerdict(0.9, 0.3, P)).toBe("other");
    expect(distanceVerdict(0.8, 0.9, P)).toBe("stranger");
    expect(distanceVerdict(0.45, 0.5, P)).toBe("ambiguous");
    expect(pairDecision([0.3, 0.9], [0.9, 0.3], 0.1)).toBe("identity");
    expect(pairDecision([0.9, 0.3], [0.3, 0.9], 0.1)).toBe("swapped");
    expect(pairDecision([0.5, 0.5], [0.5, 0.5], 0.1)).toBe("ambiguous");
  });

  /** One paired check: each player's lock is on the given person. */
  function check(s: IdentityState, faces: [number[], number[]], now: number): IdentityState {
    s = recognitionCheck(s, 0, dists(sample(faces[0], rng)), now, P).state;
    return recognitionCheck(s, 1, dists(sample(faces[1], rng)), now + 375, P).state;
  }

  it("identity holds under noise", () => {
    let s = seated();
    for (let i = 0; i < 50; i++) s = check(s, [alice, bob], i * 750);
    expect(s.counts.remap).toBe(0);
    expect(s.players.every((t) => t.verified)).toBe(true);
    expect(identitySettled(s, [true, true], 50 * 750)).toBe(true);
  });

  it("a clear swap remaps only after two consecutive checks", () => {
    let s = seated();
    const p1Box = s.players[0].box;
    s = check(s, [bob, alice], 0);
    expect(s.counts.remap).toBe(0);
    s = check(s, [bob, alice], 750);
    expect(s.counts.remap).toBe(1);
    // The locks changed owners: P1 now follows the face that was tracked as P2.
    expect(s.players[1].box).toEqual(p1Box);
    // And from then on the identity holds.
    for (let i = 2; i < 10; i++) s = check(s, [alice, bob], i * 750);
    expect(s.counts.remap).toBe(1);
  });

  it("a single noisy check doesn't remap", () => {
    let s = seated();
    for (let i = 0; i < 20; i++) {
      s = check(s, i === 7 ? [bob, alice] : [alice, bob], i * 750);
    }
    expect(s.counts.remap).toBe(0);
  });

  it("ambiguous checks change nothing", () => {
    let s = seated();
    const before = s.players.map((t) => t.box);
    for (let i = 0; i < 10; i++) {
      s = recognitionCheck(s, 0, [0.5, 0.52], i * 750, P).state;
      s = recognitionCheck(s, 1, [0.52, 0.5], i * 750 + 375, P).state;
    }
    expect(s.counts.remap).toBe(0);
    expect(s.players.map((t) => t.status)).toEqual(["locked", "locked"]);
    expect(s.players.map((t) => t.box)).toEqual(before);
  });

  it("a stranger in a seat loses the slot (after two checks), and is never given one", () => {
    let s = seated();
    s = recognitionCheck(s, 1, dists(sample(carol, rng)), 0, P).state;
    expect(s.players[1].status).toBe("locked");
    s = recognitionCheck(s, 1, dists(sample(carol, rng)), 750, P).state;
    expect(s.players[1].status).toBe("lost");
    expect(s.players[1].reason).toBe("stranger");
    expect(identitySettled(s, [true, true], 750)).toBe(false);
    // While searching, the stranger is nobody's.
    expect(recognize(dists(sample(carol, rng)), P)).toBeNull();
  });

  it("re-acquisition after a loss picks the right player, even in the other half of the image", () => {
    let s = seated();
    // Bob's lock is lost (he stood up), and comes back sitting on the left.
    for (let t = 0; t <= 2500; t += 100) s = trackFace(s, 1, null, t, P).state;
    expect(s.players[1].status).toBe("lost");
    const where = faceAt(0.15);
    const who = recognize(dists(sample(bob, rng)), P);
    expect(who).toBe(1);
    const res = acquireFace(s, who!, where, "match", 2600, P);
    expect(res.accepted).toBe(true);
    expect(res.state.players[1].box).toEqual(where);
  });

  it("a face tracked as one player that is the other (whose lock is lost) moves to them", () => {
    let s = seated();
    for (let t = 0; t <= 2500; t += 100) s = trackFace(s, 1, null, t, P).state;
    // P1's lock is actually on Bob now (Alice left, Bob moved over).
    s = recognitionCheck(s, 0, dists(sample(bob, rng)), 3000, P).state;
    expect(s.counts.remap).toBe(0);
    s = recognitionCheck(s, 0, dists(sample(bob, rng)), 3750, P).state;
    expect(s.counts.remap).toBe(1);
    expect(s.players[1].status).toBe("locked");
    expect(s.players[0].status).toBe("lost");
  });

  it("a remap carries everything player-keyed with the player", () => {
    // The controller keys calibration, score and steering by player; the
    // tracker routes each lock's frames to its owner. Simulate that routing.
    const data = [{ name: "alice", calibration: "cal-A", homeRoll: 3 }, { name: "bob", calibration: "cal-B", homeRoll: -2 }];
    let s = seated();
    const faceBoxes = { alice: faceAt(0.3), bob: faceAt(0.7) };
    // Mid-match they swap seats physically (paused), and the locks re-find them in the swapped places.
    s = { ...s, players: [{ ...s.players[0], box: faceBoxes.bob }, { ...s.players[1], box: faceBoxes.alice }] };
    s = check(s, [bob, alice], 0);
    s = check(s, [bob, alice], 750);
    expect(s.counts.remap).toBe(1);
    // Player 0 (Alice's data) now follows the box where Alice sits.
    expect(s.players[0].box).toEqual(faceBoxes.alice);
    expect(data[0]).toEqual({ name: "alice", calibration: "cal-A", homeRoll: 3 });
    expect(s.players[1].box).toEqual(faceBoxes.bob);
  });
});

describe("identity guards (scripted box sequences)", () => {
  it("two heads approaching each other don't swap", () => {
    let s = seated();
    // They lean toward each other until their boxes almost touch, then back.
    const path = [...Array.from({ length: 30 }, (_, i) => i / 29), ...Array.from({ length: 30 }, (_, i) => 1 - i / 29)];
    let t = 0;
    for (const k of path) {
      t += 33;
      s = trackFace(s, 0, faceAt(0.3 + 0.1 * k), t, P).state;
      s = trackFace(s, 1, faceAt(0.7 - 0.1 * k), t, P).state;
      s = guardConvergence(s, P).state;
      expect(s.players[0].box!.x).toBeGreaterThan(s.players[1].box!.x);
    }
    expect(s.counts.converge + s.counts.remap + s.counts.jump).toBe(0);
    expect(identitySettled(s, [true, true], 2000)).toBe(true);
  });

  it("one face seen through both crops: never both locks", () => {
    let s = seated();
    const shared = faceAt(0.5);
    s = { ...s, players: [{ ...s.players[0], box: faceAt(0.47) }, { ...s.players[1], box: faceAt(0.53) }] };
    s = trackFace(s, 0, shared, 33, P).state;
    s = trackFace(s, 1, shared, 33, P).state;
    const res = guardConvergence(s, P);
    expect(res.events.map((e) => e.type)).toContain("converge");
    expect(res.state.players.filter((t) => t.status !== "lost")).toHaveLength(1);
    // And searching can't hand the dropped player the face the other one holds.
    const lostId = res.state.players.findIndex((t) => t.status === "lost") as PlayerId;
    expect(acquireFace(res.state, lostId, shared, "match", 66, P).accepted).toBe(false);
  });

  it("convergence drops the lock whose identity matches worse", () => {
    let s = seated();
    s = { ...s, players: [{ ...s.players[0], box: faceAt(0.5), dist: [0.3, 0.9] }, { ...s.players[1], box: faceAt(0.51), dist: [0.85, 0.7] }] };
    const res = guardConvergence(s, P);
    expect(res.state.players[0].status).toBe("locked");
    expect(res.state.players[1].status).toBe("lost");
    expect(res.state.players[1].reason).toBe("converge");
  });

  it("a jitter-noisy track stays locked", () => {
    let s = seated();
    const rng = mulberry32(5);
    for (let i = 0; i < 300; i++) {
      const j = () => (rng() * 2 - 1) * 0.02;
      s = trackFace(s, 0, faceAt(0.3 + j(), 0.4 + j(), 0.18 * (1 + j())), i * 33, P).state;
      // An occasional dropped frame.
      s = trackFace(s, 1, i % 17 === 0 ? null : faceAt(0.7 + j(), 0.4 + j()), i * 33, P).state;
      s = guardConvergence(s, P).state;
    }
    expect(s.players.map((t) => t.status)).toEqual(["locked", "locked"]);
    expect(s.counts.jump + s.counts.lost + s.counts.converge).toBe(0);
  });

  it("a jump is not followed; a face gone for lostTime drops the lock", () => {
    let s = seated();
    const res = trackFace(s, 0, faceAt(0.6), 33, P);
    expect(res.events.map((e) => e.type)).toEqual(["jump"]);
    expect(res.state.players[0].box).toEqual(faceAt(0.3));
    expect(res.state.players[0].status).toBe("missing");
    s = res.state;
    expect(missingFor(s, 0, 1033)).toBeCloseTo(1.033 - 0, 2);
    s = trackFace(s, 0, null, 1900, P).state;
    expect(s.players[0].status).toBe("missing");
    s = trackFace(s, 0, null, 2100, P).state;
    expect(s.players[0].status).toBe("lost");
    expect(missingFor(s, 0, 2100)).toBe(Infinity);
  });

  it("a dropped detection or two keeps the face confirmed", () => {
    let s = seated();
    s = trackFace(s, 0, faceAt(0.3), 100, P).state;
    s = trackFace(s, 0, null, 133, P).state;
    expect(s.players[0].status).toBe("missing");
    expect(identitySettled(s, [true, true], 200)).toBe(true);
    s = trackFace(s, 0, faceAt(0.305), 300, P).state;
    expect(s.players[0].verified).toBe(true);
    expect(identitySettled(s, [true, true], 300)).toBe(true);
  });

  it("a returning face after a short gap is followed but must be verified again", () => {
    let s = seated();
    s = trackFace(s, 0, null, 500, P).state;
    expect(identitySettled(s, [true, true], 600)).toBe(false);
    s = trackFace(s, 0, faceAt(0.31), 900, P).state;
    expect(s.players[0].status).toBe("locked");
    expect(identitySettled(s, [true, true], 900)).toBe(false);
    s = recognitionCheck(s, 0, [0.3, 0.9], 1000, P).state;
    s = recognitionCheck(s, 1, [0.9, 0.3], 1100, P).state;
    expect(identitySettled(s, [true, true], 1100)).toBe(true);
  });

  it("at the seat check (no identity yet) the seat side decides", () => {
    const s = initialIdentity();
    expect(acquireFace(s, 0, faceAt(0.7), null, 0, P).accepted).toBe(false);
    expect(acquireFace(s, 1, faceAt(0.7), null, 0, P).accepted).toBe(true);
    // With recognition, the side doesn't matter.
    expect(acquireFace(s, 0, faceAt(0.7), "match", 0, P).accepted).toBe(true);
  });
});

describe("fallback without the recognition model", () => {
  /** A signature from a flat colour: torso colour and hair/skin colour. */
  function sig(torso: [number, number, number], head: [number, number, number] = [200, 160, 130]): Signature {
    const px = (c: [number, number, number]) => Array.from({ length: 64 }, () => [...c, 255]).flat();
    return { torso: hsvHistogram(px(torso)), head: hsvHistogram(px(head)) };
  }
  const red = sig([200, 30, 30]);
  const blue = sig([30, 60, 200]);
  const green = sig([30, 180, 40]);
  const params = { minSimilarity: 0.7, margin: 0.1 };

  it("colour histograms tell clothes apart", () => {
    expect(bhattacharyya(red.torso!, red.torso!)).toBeCloseTo(1);
    expect(bhattacharyya(red.torso!, blue.torso!)).toBeLessThan(0.2);
    expect(appearanceVerdict(red, [red, blue], 0, params)).toBe("match");
    expect(appearanceVerdict(blue, [red, blue], 0, params)).toBe("other");
    expect(appearanceVerdict(green, [red, blue], 0, params)).toBe("stranger");
    // Look-alike clothes: only "is it the player at all", the seat sides do the rest.
    expect(appearanceVerdict(red, [red, red], 0, params)).toBe("match");
  });

  it("a bystander in a player's seat is rejected by appearance", () => {
    let s = seated(FALLBACK);
    for (let t = 0; t <= 2500; t += 100) s = trackFace(s, 1, null, t, FALLBACK).state;
    expect(s.players[1].status).toBe("lost");
    const verdict = appearanceVerdict(green, [red, blue], 1, params);
    const res = acquireFace(s, 1, faceAt(0.7), verdict, 3000, FALLBACK);
    expect(res.accepted).toBe(false);
    expect(res.events.map((e) => e.type)).toEqual(["stranger"]);
  });

  it("both leave and come back in swapped seats: pause and ask, never remap", () => {
    let s = seated(FALLBACK);
    for (let t = 0; t <= 2500; t += 100) {
      s = trackFace(s, 0, null, t, FALLBACK).state;
      s = trackFace(s, 1, null, t, FALLBACK).state;
    }
    // Bob (blue) sits on the left, Alice (red) on the right.
    const left = acquireFace(s, 0, faceAt(0.3), appearanceVerdict(blue, [red, blue], 0, params), 3000, FALLBACK);
    expect(left.accepted).toBe(false);
    expect(left.state.players[0].reason).toBe("swap");
    const right = acquireFace(left.state, 1, faceAt(0.7), appearanceVerdict(red, [red, blue], 1, params), 3000, FALLBACK);
    expect(right.accepted).toBe(false);
    expect(right.state.counts.swap).toBe(2);
    expect(right.state.counts.remap).toBe(0);
    expect(identitySettled(right.state, [true, true], 3000)).toBe(false);
    // They swap back: accepted.
    let back = acquireFace(right.state, 0, faceAt(0.3), appearanceVerdict(red, [red, blue], 0, params), 3100, FALLBACK);
    back = acquireFace(back.state, 1, faceAt(0.7), appearanceVerdict(blue, [red, blue], 1, params), 3100, FALLBACK);
    expect(back.state.players.map((t) => t.status)).toEqual(["locked", "locked"]);
    expect(identitySettled(back.state, [true, true], 3100)).toBe(true);
  });

  it("the seat side matters: a face on the wrong side isn't acquired", () => {
    const s = initialIdentity();
    expect(acquireFace(s, 0, faceAt(0.8), "match", 0, FALLBACK).accepted).toBe(false);
  });

  it("a lock that drifts across the midline must pass the next check", () => {
    let s = seated(FALLBACK);
    s = trackFace(s, 0, faceAt(0.36), 33, FALLBACK).state;
    s = trackFace(s, 0, faceAt(0.42), 66, FALLBACK).state;
    s = trackFace(s, 0, faceAt(0.5), 99, FALLBACK).state;
    expect(s.players[0].suspicious).toBe(false);
    s = trackFace(s, 0, faceAt(0.56), 132, FALLBACK).state;
    expect(s.players[0].suspicious).toBe(true);
    expect(s.counts.midline).toBe(1);
    expect(identitySettled(s, [true, true], 132)).toBe(false);
    // It's still Alice: fine.
    const ok = appearanceCheck(s, 0, "match", [0.9, 0.1], FALLBACK).state;
    expect(ok.players[0].suspicious).toBe(false);
    // Not clearly Alice: dropped.
    const bad = appearanceCheck(s, 0, "ambiguous", [0.6, 0.6], FALLBACK).state;
    expect(bad.players[0].status).toBe("lost");
    expect(bad.players[0].reason).toBe("midline");
  });

  it("repeated failed appearance checks freeze the seat; a swap is reported as one", () => {
    let s = seated(FALLBACK);
    s = appearanceCheck(s, 1, "other", [0.9, 0.2], FALLBACK).state;
    s = appearanceCheck(s, 1, "other", [0.9, 0.2], FALLBACK).state;
    expect(s.players[1].status).toBe("locked");
    s = appearanceCheck(s, 1, "other", [0.9, 0.2], FALLBACK).state;
    expect(s.players[1].status).toBe("lost");
    expect(s.players[1].reason).toBe("swap");
    expect(s.counts.remap).toBe(0);
  });
});
