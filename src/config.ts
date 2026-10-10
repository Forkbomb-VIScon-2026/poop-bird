// Every gameplay / detection tunable lives here.
//
// The debug panel (press D) builds a slider for each entry in CONFIG_SPEC and
// writes changes into the live `config` object, which every system reads each
// frame. Changes are persisted to localStorage; "Reset to defaults" clears them.
//
// Units: distances in logical pixels (the playfield is 600 px tall), times in
// seconds, speeds in px/s, accelerations in px/s².

import { DEBUG } from "./env";
import { storageGet, storageRemove, storageSet } from "./storage";

export interface TunableSpec {
  value: number;
  min: number;
  max: number;
  step: number;
  group: string;
  label: string;
  hint?: string;
}

export const CONFIG_SPEC = {
  // --- Physics -------------------------------------------------------------
  gravity: { value: 420, min: 200, max: 2500, step: 10, group: "Physics", label: "Gravity", hint: "px/s²" },
  maxFallSpeed: { value: 220, min: 100, max: 1200, step: 10, group: "Physics", label: "Max fall speed", hint: "px/s" },
  chargeGravityScale: {
    value: 0.5, min: 0, max: 1, step: 0.05, group: "Physics", label: "Gravity while charging",
    hint: "× gravity while straining (the bird tenses up and glides a bit)",
  },
  chargeMaxFallSpeed: {
    value: 100, min: 20, max: 1200, step: 10, group: "Physics", label: "Max fall while charging",
    hint: "px/s; lets you hold a long strain without hitting the ground",
  },
  pushMin: { value: 120, min: 0, max: 800, step: 10, group: "Physics", label: "Push: tiny pfft", hint: "upward px/s at ~0 charge" },
  pushMax: { value: 480, min: 100, max: 1500, step: 10, group: "Physics", label: "Push: full charge", hint: "upward px/s at full charge" },
  pushCurve: { value: 0.8, min: 0.3, max: 3, step: 0.05, group: "Physics", label: "Push curve", hint: "exponent on charge (<1 = small strains count more)" },
  startGrace: {
    value: 1.5, min: 0, max: 5, step: 0.1, group: "Physics", label: "Start grace",
    hint: "s after GO over which gravity ramps from 0 to full",
  },
  fallCancel: { value: 0.85, min: 0, max: 1, step: 0.05, group: "Physics", label: "Fall cancel on push", hint: "fraction of downward speed removed on push" },

  // --- Charge & overstrain -------------------------------------------------
  chargeTime: { value: 1.2, min: 0.2, max: 4, step: 0.05, group: "Charge", label: "Charge time", hint: "s to fill 0→1" },
  overstrainTime: { value: 1.0, min: 0.2, max: 4, step: 0.05, group: "Charge", label: "Overstrain time", hint: "s at full charge before an accident" },
  sweetSpotWindow: { value: 0.3, min: 0, max: 2, step: 0.05, group: "Charge", label: "Sweet-spot window", hint: "s right before the accident that pays a bonus" },
  sweetSpotMultiplier: { value: 1.35, min: 1, max: 3, step: 0.05, group: "Charge", label: "Sweet-spot bonus", hint: "× push" },
  stunTime: { value: 1.0, min: 0.2, max: 3, step: 0.05, group: "Charge", label: "Accident stun", hint: "s tumbling without push" },
  poopSoundMiddle: { value: 0.35, min: 0, max: 1, step: 0.05, group: "Charge", label: "Middle poop sound", hint: "charge from which a release plays the middle sample (below: weak)" },
  poopSoundLarge: { value: 0.75, min: 0, max: 1, step: 0.05, group: "Charge", label: "Large poop sound", hint: "charge from which a release plays the large sample" },

  // --- Face lock ------------------------------------------------------------
  faceCropScale: { value: 2.2, min: 1.3, max: 4, step: 0.1, group: "Face lock", label: "Crop size", hint: "× the locked face box; detection only sees this square around the player" },
  faceLockMaxJump: {
    value: 0.8, min: 0.2, max: 3, step: 0.1, group: "Face lock", label: "Max jump",
    hint: "face sizes the locked face may move between detections; a face farther away (or ±50% in size) is someone else",
  },
  faceRelockSeconds: { value: 2.0, min: 0.2, max: 5, step: 0.1, group: "Face lock", label: "Relock after", hint: "s without the locked face before searching the full frame again" },

  // --- Strain detection ----------------------------------------------------
  strainOn: { value: 0.45, min: 0.05, max: 0.95, step: 0.01, group: "Strain", label: "On threshold" },
  strainOff: { value: 0.3, min: 0.02, max: 0.9, step: 0.01, group: "Strain", label: "Off threshold" },
  emaAlpha: { value: 0.45, min: 0.05, max: 1, step: 0.01, group: "Strain", label: "EMA factor", hint: "per frame at 30 fps; 1 = no smoothing" },
  faceLossGrace: { value: 0.25, min: 0, max: 1.5, step: 0.05, group: "Strain", label: "Face-loss grace", hint: "s a lost face keeps its strain (bridges dropped frames)" },
  minFaceCoverage: { value: 0.6, min: 0, max: 1, step: 0.05, group: "Strain", label: "Min face coverage", hint: "calibration: fraction of frames per phase that must see a face" },
  featureClampMax: { value: 1.3, min: 1, max: 3, step: 0.05, group: "Strain", label: "Feature clamp max", hint: "normalized features are clamped to 0..this" },
  minFeatureDelta: { value: 0.04, min: 0, max: 0.3, step: 0.01, group: "Strain", label: "Min feature change", hint: "calibration change below this gets zero weight" },
  minCalibrationChange: { value: 0.25, min: 0, max: 2, step: 0.01, group: "Strain", label: "Min total change", hint: "calibration quality: summed weights must exceed this" },
  calibrationSeconds: { value: 3, min: 1, max: 8, step: 0.5, group: "Strain", label: "Calibration phase", hint: "s per phase" },
  calibrationSettle: { value: 0.7, min: 0, max: 2, step: 0.1, group: "Strain", label: "Calibration settle", hint: "s ignored at the start of each phase" },
  defaultNeutralSeconds: {
    value: 1.5, min: 0.5, max: 5, step: 0.1, group: "Strain", label: "Default: relaxed read",
    hint: "s of relaxed face read on the strain check when the player skips calibration",
  },
  slowDetectionRate: {
    value: 8, min: 0, max: 30, step: 1, group: "Strain", label: "Slow tracking warning",
    hint: "detections/s below which the strain check suggests touch or keyboard play (slow phones)",
  },
  defaultStrainScale: {
    value: 1, min: 0.3, max: 2.5, step: 0.05, group: "Strain", label: "Default: strain scale",
    hint: "× the typical strain change of the default calibration (<1 = easier to strain); applies on the next relaxed read",
  },

  // --- World ---------------------------------------------------------------
  scrollSpeed: { value: 170, min: 50, max: 600, step: 5, group: "World", label: "Scroll speed (start)", hint: "px/s" },
  scrollSpeedMax: { value: 260, min: 50, max: 800, step: 5, group: "World", label: "Scroll speed (max)", hint: "px/s" },
  obstacleGap: { value: 250, min: 100, max: 500, step: 5, group: "World", label: "Gap (start)", hint: "px" },
  obstacleGapMin: { value: 175, min: 80, max: 500, step: 5, group: "World", label: "Gap (hardest)", hint: "px" },
  obstacleSpacing: { value: 460, min: 150, max: 1200, step: 10, group: "World", label: "Spacing (start)", hint: "px between obstacles" },
  obstacleSpacingMin: { value: 320, min: 150, max: 1200, step: 10, group: "World", label: "Spacing (hardest)", hint: "px" },
  difficultyRamp: { value: 6000, min: 500, max: 30000, step: 100, group: "World", label: "Difficulty ramp", hint: "px of distance to reach max difficulty" },
  firstObstacleDelay: { value: 700, min: 0, max: 3000, step: 50, group: "World", label: "First obstacle after", hint: "px" },

  // --- Progression ---------------------------------------------------------
  // Distance drives speed and gaps (above); these step up with each new city
  // stage instead (1 = the first city, 2 = the city after the first dive, …).
  cityStagesToHardest: {
    value: 4, min: 1, max: 10, step: 1, group: "Progression", label: "Hardest from city",
    hint: "city stage at which tall buildings, wire gaps and kid timing reach their hardest",
  },
  tallBuildingChance: {
    value: 0.08, min: 0, max: 1, step: 0.01, group: "Progression", label: "Tall buildings (start)",
    hint: "chance a building's gap is in the top 40% of the sky (a tall building) in the first city",
  },
  tallBuildingChanceMax: { value: 0.5, min: 0, max: 1, step: 0.01, group: "Progression", label: "Tall buildings (hardest)", hint: "chance" },
  powerLineFirstCity: {
    value: 2, min: 1, max: 10, step: 1, group: "Progression", label: "Power lines from city",
    hint: "first city stage with power lines; one wire there, up to two in the next, two or three after",
  },
  kidFirstCity: {
    value: 2, min: 1, max: 10, step: 1, group: "Progression", label: "Kids from city",
    hint: "first city stage with slingshot kids; each later city adds a shot (up to Max shots)",
  },

  // --- Power lines ---------------------------------------------------------
  powerLineChance: { value: 0.35, min: 0, max: 1, step: 0.05, group: "Power lines", label: "Chance", hint: "chance a city obstacle is a power line instead of a building" },
  powerLineAudioRange: { value: 400, min: 100, max: 1000, step: 25, group: "Power lines", label: "Electrical hum range", hint: "px distance from bird to wire at which power-line hum starts" },
  powerLineSpan: { value: 340, min: 150, max: 700, step: 10, group: "Power lines", label: "Pole spacing", hint: "px between poles" },
  powerLineSag: { value: 36, min: 0, max: 120, step: 2, group: "Power lines", label: "Wire sag", hint: "px a wire hangs down mid-span (±30%)" },
  powerLineWireGap: { value: 130, min: 60, max: 250, step: 5, group: "Power lines", label: "Wire gap (start)", hint: "px between stacked wires, in the first city with power lines" },
  powerLineWireGapMin: { value: 100, min: 60, max: 250, step: 5, group: "Power lines", label: "Wire gap (hardest)", hint: "px" },
  pigeonsPerSpan: { value: 1.3, min: 0, max: 4, step: 0.1, group: "Power lines", label: "Pigeons per span", hint: "average pigeons sitting on the wires between two poles" },
  droneChance: { value: 0.35, min: 0, max: 1, step: 0.05, group: "Power lines", label: "Drone chance", hint: "chance a hit pigeon turns out to be a surveillance drone and crashes to the street" },
  pigeonMultiplier: { value: 2, min: 0, max: 10, step: 0.5, group: "Power lines", label: "Pigeon points", hint: "× points per hit (× combo)" },

  // --- Balloons ------------------------------------------------------------
  balloonChance: { value: 0.2, min: 0, max: 1, step: 0.05, group: "Balloons", label: "Chance", hint: "chance a city obstacle is a hot-air balloon (rolled after the power line chance)" },
  balloonDrift: { value: 20, min: 0, max: 120, step: 5, group: "Balloons", label: "Wind drift", hint: "px/s the balloon drifts forward" },
  balloonPopMultiplier: { value: 4, min: 0, max: 10, step: 0.5, group: "Balloons", label: "Pop points", hint: "× points for popping the envelope (× combo)" },
  balloonLift: { value: 340, min: 0, max: 1000, step: 10, group: "Balloons", label: "Hot-air lift", hint: "upward px/s the bird gets when it pops the envelope itself" },
  balloonPassengerMultiplier: { value: 2, min: 0, max: 10, step: 0.5, group: "Balloons", label: "Parachutist points", hint: "× points per hit on a bailed-out passenger (× combo)" },
  balloonChuteWind: { value: 0.8, min: 0, max: 1.2, step: 0.05, group: "Balloons", label: "Parachute wind", hint: "× scroll speed the parachutists are carried forward at (1 = they stay put on screen)" },
  balloonChuteFall: { value: 55, min: 10, max: 300, step: 5, group: "Balloons", label: "Parachute fall", hint: "px/s under an open canopy" },
  balloonThreadMultiplier: { value: 6, min: 0, max: 20, step: 0.5, group: "Balloons", label: "Thread bonus", hint: "× points for slipping between envelope and basket untouched" },

  // --- Targets & score -----------------------------------------------------
  poopGravity: { value: 1000, min: 100, max: 3000, step: 50, group: "Targets", label: "Poop gravity", hint: "px/s² (separate from the bird so aiming stays the same)" },
  targetSpawnRate: { value: 0.55, min: 0, max: 3, step: 0.05, group: "Targets", label: "Spawn rate", hint: "targets per second" },
  statueChance: { value: 0.05, min: 0, max: 0.5, step: 0.01, group: "Targets", label: "Statue chance", hint: "share of street targets that are statues (skipped where they'd overlap a building or pole)" },
  targetPoints: { value: 50, min: 0, max: 500, step: 5, group: "Targets", label: "Points per hit", hint: "base; cars ×1, pedestrians ×1.5, statue ×2" },
  comboStep: { value: 0.5, min: 0, max: 2, step: 0.05, group: "Targets", label: "Combo step", hint: "multiplier added per consecutive hit" },
  comboMax: { value: 5, min: 1, max: 20, step: 0.5, group: "Targets", label: "Combo max", hint: "multiplier cap" },
  distancePerPoint: { value: 10, min: 1, max: 100, step: 1, group: "Targets", label: "Distance per point", hint: "px of travel per score point" },

  // --- Paparazzi -----------------------------------------------------------
  paparazziChance: { value: 0.18, min: 0, max: 1, step: 0.01, group: "Paparazzi", label: "Spawn chance", hint: "chance that a target spawn is a paparazzo instead" },
  paparazziMinDistance: { value: 1500, min: 0, max: 10000, step: 50, group: "Paparazzi", label: "First after", hint: "px of distance before the first paparazzo" },
  paparazziMinGap: { value: 2200, min: 0, max: 10000, step: 50, group: "Paparazzi", label: "Min gap", hint: "px of distance between paparazzi" },
  paparazziShotOffset: { value: 50, min: -200, max: 300, step: 5, group: "Paparazzi", label: "Shot point", hint: "px past the bird where his timer runs out and he takes the shot" },
  paparazziTutorialWalk: { value: 60, min: 0, max: 200, step: 5, group: "Paparazzi", label: "First one walks", hint: "px/s the run's first paparazzo walks along (more time to react)" },
  paparazziMultiplier: { value: 3, min: 0, max: 10, step: 0.5, group: "Paparazzi", label: "Points", hint: "× points for splatting him before the shot (× combo)" },

  // --- Slingshot kids -----------------------------------------------------
  kidChance: { value: 0.3, min: 0, max: 1, step: 0.01, group: "Slingshot kids", label: "Spawn chance", hint: "chance that a target spawn is a slingshot kid instead" },
  kidMinDistance: { value: 1100, min: 0, max: 10000, step: 50, group: "Slingshot kids", label: "First after", hint: "px of distance before the first kid" },
  kidMinGap: { value: 1500, min: 0, max: 10000, step: 50, group: "Slingshot kids", label: "Min gap", hint: "px of distance between kids" },
  kidWalkSpeed: { value: 35, min: 0, max: 200, step: 5, group: "Slingshot kids", label: "Walk speed", hint: "px/s he trots toward the bird before taking aim" },
  kidRange: { value: 560, min: 150, max: 1200, step: 10, group: "Slingshot kids", label: "Aim range", hint: "px ahead of the bird where he plants his feet and aims" },
  kidWindup: { value: 1.0, min: 0.2, max: 3, step: 0.05, group: "Slingshot kids", label: "Wind-up (start)", hint: "s of pulling back (the warning) before the shot, in the first city with kids" },
  kidWindupMin: { value: 0.65, min: 0.2, max: 3, step: 0.05, group: "Slingshot kids", label: "Wind-up (hardest)", hint: "s" },
  kidFlightTime: { value: 0.85, min: 0.2, max: 2, step: 0.05, group: "Slingshot kids", label: "Flight time (start)", hint: "s a pebble takes to reach the bird (time to dodge), in the first city with kids" },
  kidFlightTimeMin: { value: 0.65, min: 0.2, max: 2, step: 0.05, group: "Slingshot kids", label: "Flight time (hardest)", hint: "s" },
  kidLead: { value: 0.3, min: 0, max: 1, step: 0.05, group: "Slingshot kids", label: "Lead", hint: "how much he aims ahead of the bird's vertical speed (0 = at the bird)" },
  kidPebbleGravity: { value: 700, min: 0, max: 2000, step: 50, group: "Slingshot kids", label: "Pebble gravity", hint: "px/s² (more = loftier arcs)" },
  kidShotsMax: { value: 2, min: 1, max: 5, step: 1, group: "Slingshot kids", label: "Max shots", hint: "pebbles per kid (1 in the first city with kids, one more each city after)" },
  kidBonkStun: { value: 0.6, min: 0, max: 3, step: 0.05, group: "Slingshot kids", label: "Bonk stun", hint: "s the bird tumbles without push after a hit" },
  kidKnockback: { value: 300, min: 0, max: 1000, step: 10, group: "Slingshot kids", label: "Knockback", hint: "px/s downward speed after a hit" },
  kidMultiplier: { value: 3, min: 0, max: 10, step: 0.5, group: "Slingshot kids", label: "Disarm points", hint: "× points for splatting him while he can still shoot (× combo)" },
  kidParryMultiplier: { value: 4, min: 0, max: 10, step: 0.5, group: "Slingshot kids", label: "Intercept points", hint: "× points for shooting a pebble down with a poop (× combo)" },

  // --- Wedding -------------------------------------------------------------
  weddingChance: { value: 0.25, min: 0, max: 1, step: 0.05, group: "Wedding", label: "Chance", hint: "chance a city stage has a wedding" },
  weddingSlot: { value: 2, min: 0, max: 10, step: 1, group: "Wedding", label: "Church slot", hint: "city obstacles before the church (it waits if a paparazzo or kid is busy)" },
  weddingKissLead: { value: 90, min: 0, max: 400, step: 5, group: "Wedding", label: "Kiss point", hint: "px ahead of the bird where the couple starts kissing (a poop takes a moment to fall)" },
  weddingKissTime: { value: 1.0, min: 0.2, max: 3, step: 0.05, group: "Wedding", label: "Kiss length", hint: "s the kiss lasts (the jackpot window)" },
  weddingBeat: { value: 0.55, min: 0.2, max: 1.5, step: 0.05, group: "Wedding", label: "Countdown beat", hint: "s per 3… 2… 1… beat before the kiss" },
  weddingKissMultiplier: { value: 10, min: 0, max: 30, step: 0.5, group: "Wedding", label: "Ruined kiss points", hint: "× points for splatting the couple mid-kiss (× combo)" },
  weddingCoupleMultiplier: { value: 3, min: 0, max: 10, step: 0.5, group: "Wedding", label: "Couple points", hint: "× points for splatting the couple outside the kiss" },
  weddingBouquetMultiplier: { value: 4, min: 0, max: 10, step: 0.5, group: "Wedding", label: "Bouquet catch", hint: "× points for catching the bride's bouquet" },
  weddingBouquetGravity: { value: 600, min: 100, max: 2000, step: 50, group: "Wedding", label: "Bouquet gravity", hint: "px/s²" },
  weddingThrowTime: { value: 0.8, min: 0.3, max: 2, step: 0.05, group: "Wedding", label: "Angry throw time", hint: "s the furious bride's bouquet takes to reach the bird" },
  weddingBouquetKnock: { value: 260, min: 0, max: 800, step: 10, group: "Wedding", label: "Bouquet knock", hint: "px/s downward speed when her bouquet hits the bird" },

  // --- Ocean stage ---------------------------------------------------------
  cityObstaclesBeforeGate: { value: 6, min: 0, max: 40, step: 1, group: "Ocean", label: "City obstacles before harbour", hint: "then the street ends at the harbour" },
  oceanObstacles: { value: 8, min: 0, max: 40, step: 1, group: "Ocean", label: "Ocean obstacles", hint: "then the far quay comes up and the surface opens" },
  oceanTransformTime: { value: 0.8, min: 0.3, max: 3, step: 0.05, group: "Ocean", label: "Transform time", hint: "s the new fish takes to inflate after the dive (without calibration)" },
  oceanScrollScale: { value: 0.85, min: 0.3, max: 1.5, step: 0.05, group: "Ocean", label: "Scroll speed scale", hint: "× the city scroll speed" },
  oceanMaxSink: { value: 150, min: 20, max: 500, step: 5, group: "Ocean", label: "Max sink speed", hint: "px/s at puff 0" },
  oceanMaxRise: { value: 150, min: 20, max: 500, step: 5, group: "Ocean", label: "Max rise speed", hint: "px/s at puff 1" },
  oceanHoverPuff: { value: 0.4, min: 0.05, max: 0.95, step: 0.01, group: "Ocean", label: "Hover puff", hint: "puff level that neither sinks nor rises" },
  oceanDragTime: { value: 0.35, min: 0.02, max: 2, step: 0.01, group: "Ocean", label: "Water drag time", hint: "s for speed to cover ~63% of the way to its target" },
  oceanSurfaceBump: { value: 60, min: 0, max: 300, step: 5, group: "Ocean", label: "Surface bump", hint: "px/s pushed back down when hitting the surface" },
  oceanHitboxMin: { value: 0.75, min: 0.3, max: 2, step: 0.05, group: "Ocean", label: "Hitbox (deflated)", hint: "× bird hit radius at puff 0 (drawn size follows)" },
  oceanHitboxMax: { value: 1.6, min: 0.3, max: 3, step: 0.05, group: "Ocean", label: "Hitbox (puffed)", hint: "× bird hit radius at puff 1" },
  oceanGap: { value: 280, min: 100, max: 500, step: 5, group: "Ocean", label: "Gap (start)", hint: "px" },
  oceanGapMin: { value: 205, min: 80, max: 500, step: 5, group: "Ocean", label: "Gap (hardest)", hint: "px" },
  oceanSpacing: { value: 540, min: 150, max: 1200, step: 10, group: "Ocean", label: "Spacing (start)", hint: "px between obstacles" },
  oceanSpacingMin: { value: 400, min: 150, max: 1200, step: 10, group: "Ocean", label: "Spacing (hardest)", hint: "px" },
  oceanGapJump: { value: 150, min: 20, max: 500, step: 5, group: "Ocean", label: "Max gap jump", hint: "px the gap centre may move between obstacles" },
  oceanAnchorChance: { value: 0.4, min: 0, max: 1, step: 0.05, group: "Ocean", label: "Anchor chance", hint: "share of ocean obstacles that are a boat with its anchor hanging down" },
  oceanAnchorOpenChance: { value: 0.35, min: 0, max: 1, step: 0.05, group: "Ocean", label: "Anchor over open water", hint: "share of anchors with nothing below (dive under) instead of coral or a rock" },
  oceanWreckChance: { value: 0.2, min: 0, max: 1, step: 0.05, group: "Ocean", label: "Shipwreck chance", hint: "share of sea-floor obstacles that are an old shipwreck (a low hull with one broken mast)" },
  oceanFirstObstacleDelay: { value: 600, min: 0, max: 3000, step: 50, group: "Ocean", label: "First obstacle after", hint: "px after each stage change" },
  oceanSpikeThreshold: { value: 0.85, min: 0.3, max: 1, step: 0.01, group: "Ocean", label: "Spike threshold", hint: "puff level that spikes the fish out" },
  oceanSpikeRelease: { value: 0.05, min: 0, max: 0.3, step: 0.01, group: "Ocean", label: "Spike release margin", hint: "spikes retract below threshold − this (no flicker)" },
  oceanSpikeMaxHold: { value: 1.5, min: 0.2, max: 5, step: 0.05, group: "Ocean", label: "Max spiked time", hint: "s spiked before a pop accident" },
  oceanPopWarnTime: { value: 0.3, min: 0, max: 2, step: 0.05, group: "Ocean", label: "Pop warning", hint: "s of flashing warning before the pop" },
  oceanJellyRate: { value: 0.35, min: 0, max: 3, step: 0.05, group: "Ocean", label: "Jellyfish rate", hint: "jellyfish per second, in open water" },
  oceanJellyPopReach: { value: 1.6, min: 1, max: 3, step: 0.05, group: "Ocean", label: "Jellyfish pop reach", hint: "× sting hitbox when spiked (popping is more forgiving)" },
  oceanJellyMultiplier: { value: 1.5, min: 0, max: 5, step: 0.1, group: "Ocean", label: "Jellyfish points", hint: "× points per hit (× combo)" },
  oceanKeyInflateRate: { value: 1.1, min: 0.1, max: 5, step: 0.05, group: "Ocean", label: "Key inflate rate", hint: "puff/s while holding Space / pointer" },
  oceanKeyDeflateRate: { value: 0.9, min: 0.1, max: 5, step: 0.05, group: "Ocean", label: "Key deflate rate", hint: "puff/s after letting go" },

  // --- Fisherman -----------------------------------------------------------
  anglerChance: { value: 0.6, min: 0, max: 1, step: 0.05, group: "Fisherman", label: "Chance", hint: "chance an ocean stage has a fisherman" },
  anglerSlot: { value: 3, min: 0, max: 20, step: 1, group: "Fisherman", label: "Slot", hint: "ocean obstacles before his boat comes" },
  anglerRow: { value: 35, min: 0, max: 150, step: 5, group: "Fisherman", label: "Rowing speed", hint: "px/s he rows against the scroll (his hook comes at you slower)" },
  anglerCastRange: { value: 640, min: 200, max: 1200, step: 10, group: "Fisherman", label: "Cast range", hint: "px ahead of the fish where he casts" },
  anglerSinkSpeed: { value: 140, min: 20, max: 500, step: 5, group: "Fisherman", label: "Sink speed", hint: "px/s the hook sinks to the depth the fish was at when he cast" },
  anglerJig: { value: 14, min: 0, max: 80, step: 1, group: "Fisherman", label: "Jig", hint: "px he jigs the hook up and down once it's down" },
  anglerReelTime: { value: 1.2, min: 0.3, max: 4, step: 0.1, group: "Fisherman", label: "Reel-in time", hint: "s from the bite until he yanks the fish out" },
  anglerSnapMultiplier: { value: 4, min: 0, max: 20, step: 0.5, group: "Fisherman", label: "Cut points", hint: "× points for cutting his line above the hook with your spikes (× combo)" },
  anglerCloseMultiplier: { value: 1, min: 0, max: 10, step: 0.5, group: "Fisherman", label: "Close-one points", hint: "× points for dodging the hook by a whisker" },

  // --- Ocean puff detection ------------------------------------------------
  oceanCalibrationSeconds: { value: 3, min: 1, max: 8, step: 0.5, group: "Ocean puff", label: "Puff calibration", hint: "s of the puff phase at the first dive (first calibrationSettle s ignored)" },
  oceanPuffMinSeparation: { value: 1.5, min: 0.2, max: 6, step: 0.1, group: "Ocean puff", label: "Min separation", hint: "a puff feature counts once its change exceeds this many noise units (full weight at 2×)" },
  oceanMinPuffChange: { value: 0.5, min: 0, max: 5, step: 0.05, group: "Ocean puff", label: "Min puff change", hint: "calibration quality: summed puff weights must exceed this (1 = one clearly separated feature)" },
  oceanFallbackMin: { value: 0.06, min: 0, max: 1, step: 0.01, group: "Ocean puff", label: "Fallback: relaxed", hint: "max(mouthPress, cheekPuff) mapped to puff 0 without a calibration" },
  oceanFallbackMax: { value: 0.22, min: 0, max: 1, step: 0.01, group: "Ocean puff", label: "Fallback: full puff", hint: "max(mouthPress, cheekPuff) mapped to puff 1 without a calibration" },
} satisfies Record<string, TunableSpec>;

export type ConfigKey = keyof typeof CONFIG_SPEC;
export type Config = Record<ConfigKey, number>;

const STORAGE_KEY = "poopbird.config.v1";

export function defaultConfig(): Config {
  const out = {} as Config;
  for (const key of Object.keys(CONFIG_SPEC) as ConfigKey[]) out[key] = CONFIG_SPEC[key].value;
  return out;
}

function loadConfig(): Config {
  const cfg = defaultConfig();
  // Tuning overrides come from the debug panel, so without it they are ignored.
  if (!DEBUG) return cfg;
  const raw = storageGet(STORAGE_KEY);
  if (!raw) return cfg;
  try {
    const saved = JSON.parse(raw) as Partial<Record<string, unknown>>;
    for (const key of Object.keys(CONFIG_SPEC) as ConfigKey[]) {
      const v = saved[key];
      if (typeof v === "number" && Number.isFinite(v)) cfg[key] = v;
    }
  } catch {
    // Corrupt entry: ignore and use defaults.
  }
  return cfg;
}

/** The live config. Mutated in place by the debug panel. */
export const config: Config = loadConfig();

export function setConfigValue(key: ConfigKey, value: number): void {
  config[key] = value;
  saveConfig();
}

export function saveConfig(): void {
  // Only store values that differ from the defaults, so new defaults apply
  // to anything the player hasn't touched.
  const defaults = defaultConfig();
  const diff: Partial<Config> = {};
  for (const key of Object.keys(CONFIG_SPEC) as ConfigKey[]) {
    if (config[key] !== defaults[key]) diff[key] = config[key];
  }
  if (Object.keys(diff).length === 0) storageRemove(STORAGE_KEY);
  else storageSet(STORAGE_KEY, JSON.stringify(diff));
}

export function resetConfig(): void {
  Object.assign(config, defaultConfig());
  storageRemove(STORAGE_KEY);
}

/** Linear interpolation from the "start" value to the "hardest" value. */
export function ramp(start: number, hardest: number, difficulty: number): number {
  return start + (hardest - start) * Math.min(1, Math.max(0, difficulty));
}
